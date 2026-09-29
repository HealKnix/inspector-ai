"""Private HTTP boundary and killable, reusable single CPU worker."""
import hmac
import json
import multiprocessing
import os
import signal
import socket
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from common import ParseError, is_uuid
from config import Settings, fingerprint, integer
from pipeline import parse, validate_request
from observability import emit, trace


def deny_network(*_args, **_kwargs):
    raise OSError("Document parser network access is disabled")


def error_response(error):
    body = {"code": error.code.lower(), "retryable": error.retryable}
    if error.admission is not None:
        body.update(error.admission)
    return body


def worker_main(connection, settings, versions):
    # Defense in depth: deployment also uses an internal network. The worker never
    # needs a socket; the parent owns HTTP and the offline model files are explicit.
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.create_connection = deny_network
    try:
        from ocr import LocalOCR
        ocr = LocalOCR(settings)
        connection.send({"type": "ready"})
        while True:
            request = connection.recv()

            def progress(completed, total, stage, details=None):
                connection.send({"type": "progress", "pages_completed": completed, "pages_total": total,
                                 "stage": stage, **(details or {})})

            try:
                result = parse(request, settings, versions, ocr, progress)
                connection.send({"type": "result", "artifact": result})
            except ParseError as error:
                connection.send({"type": "error", "code": error.code, "retryable": error.retryable, "status": error.status})
            except MemoryError:
                connection.send({"type": "error", "code": "RESOURCE_LIMIT", "retryable": False, "status": 422})
            except Exception:
                # Never put native-library errors, content or paths into responses/logs.
                connection.send({"type": "error", "code": "PARSER_FAILURE", "retryable": True, "status": 503})
    except (EOFError, BrokenPipeError):
        return
    except Exception:
        try:
            connection.send({"type": "startup_error"})
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


class Supervisor:
    def __init__(self, settings, versions, worker_target=worker_main):
        self.settings, self.versions = settings, versions
        self.context = multiprocessing.get_context("spawn")
        self.worker_target = worker_target
        self.lock = threading.Lock()
        self.active = None
        self.cancelled = False
        self.ready = False
        self.progress = OrderedDict()
        self.process = None
        self.connection = None
        self.booted = 0
        self.start()

    def start(self):
        parent, child = self.context.Pipe()
        self.process = self.context.Process(target=self.worker_target, args=(child, self.settings, self.versions), daemon=True)
        self.process.start()
        child.close()
        self.connection = parent
        self.ready = False
        self.booted = time.monotonic()

    def stop(self):
        self.ready = False
        if self.process and self.process.is_alive():
            self.process.terminate()
            self.process.join(2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(2)
        if self.connection:
            self.connection.close()

    def health(self):
        with self.lock:
            if not self.active and (not self.ready or not self.process.is_alive()):
                try:
                    if self.connection.poll():
                        event = self.connection.recv()
                        self.ready = event.get("type") == "ready"
                except (EOFError, OSError):
                    self.ready = False
                # A queued ready event wins over the startup deadline. Also
                # restart an idle child that died after previously becoming ready.
                if not self.process.is_alive() or (not self.ready and time.monotonic() - self.booted > 180):
                    self.stop()
                    self.start()
            if not self.ready or not self.process.is_alive():
                raise ParseError("MODELS_NOT_READY", retryable=True, status=503)
            return {"status": "ok", "pipeline_fingerprint": fingerprint(self.versions), "versions": self.versions}

    def get_progress(self, request_id):
        with self.lock:
            if request_id not in self.progress:
                raise ParseError("REQUEST_NOT_FOUND", status=404)
            return self.progress[request_id].copy()

    def cancel(self, request_id):
        with self.lock:
            if self.active != request_id:
                return {"cancelled": False}
            self.cancelled = True
            # Termination is synchronous: success means CPU work is no longer running.
            self.process.terminate()
            self.process.join(2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(2)
            self.ready = False
            return {"cancelled": True}

    def run(self, request):
        self.health()
        request_id = request["request_id"]
        with self.lock:
            if self.active:
                raise ParseError("PARSER_BUSY", retryable=True, status=503)
            self.active, self.cancelled = request_id, False
            self.progress[request_id] = {"request_id": request_id, "pipeline_fingerprint": fingerprint(self.versions),
                "pages_completed": 0, "pages_total": None, "stage": "starting", "checkpoint_validated": False,
                "checkpoint_pages": None, "current_page": None}
            while len(self.progress) > 1024:
                self.progress.popitem(last=False)
            try:
                self.connection.send(request)
            except (OSError, EOFError):
                self.active = None
                self.stop()
                self.start()
                raise ParseError("PARSER_WORKER_EXIT", retryable=True, status=503) from None
        deadline = time.monotonic() + self.settings.timeout
        admission = {"admitted": True, "request_id": request_id, "pipeline_fingerprint": fingerprint(self.versions)}
        restart = False
        try:
            while True:
                if self.cancelled:
                    restart = True
                    raise ParseError("PARSER_CANCELLED", retryable=True, status=503)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    restart = True
                    raise ParseError("PARSER_TIMEOUT", retryable=True, status=504)
                if not self.connection.poll(min(.2, remaining)):
                    if not self.process.is_alive():
                        restart = True
                        raise ParseError("PARSER_WORKER_EXIT", retryable=True, status=503)
                    continue
                event = self.connection.recv()
                if event["type"] == "progress":
                    with self.lock:
                        for key in ("pages_completed", "pages_total", "stage", "checkpoint_validated", "checkpoint_pages", "current_page"):
                            if key in event:
                                self.progress[request_id][key] = event[key]
                elif event["type"] == "result":
                    return event["artifact"]
                elif event["type"] == "error":
                    raise ParseError(event["code"], event["retryable"], event["status"])
        except ParseError as error:
            # Fast failures may precede the backend's first progress poll. This
            # proof belongs only to this request, after health/busy/send gates.
            error.admission = admission
            raise
        except (EOFError, BrokenPipeError, OSError) as error:
            restart = True
            raise ParseError("PARSER_CANCELLED" if self.cancelled else "PARSER_WORKER_EXIT", retryable=True,
                             status=503, admission=admission) from error
        finally:
            with self.lock:
                if restart:
                    self.stop()
                    self.start()
                self.active = None


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalParser/1"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_args):
        pass  # URL/request identifiers and documents are deliberately not logged here.

    def reply(self, status, body):
        self.observation_status = status
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass  # Accepted CPU work is bounded independently of the HTTP connection.

    def dispatch(self):
        expected = "Bearer " + self.server.token
        if not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
            raise ParseError("UNAUTHORIZED", status=401)
        if self.command == "GET" and self.path == "/health":
            return self.server.supervisor.health()
        if self.command == "GET" and self.path.startswith("/progress/"):
            request_id = self.path[len("/progress/"):]
            if not is_uuid(request_id):
                raise ParseError("INVALID_REQUEST", status=400)
            return self.server.supervisor.get_progress(request_id)
        if self.command == "POST" and self.path.startswith("/cancel/"):
            request_id = self.path[len("/cancel/"):]
            if not is_uuid(request_id):
                raise ParseError("INVALID_REQUEST", status=400)
            return self.server.supervisor.cancel(request_id)
        if self.command == "POST" and self.path == "/parse":
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                raise ParseError("INVALID_CONTENT_TYPE", status=415)
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get("Transfer-Encoding"):
                raise ParseError("INVALID_REQUEST", status=400)
            request = validate_request(json.loads(self.rfile.read(length)))
            return self.server.supervisor.run(request)
        raise ParseError("NOT_FOUND", status=404)

    def handle_request(self):
        started = time.monotonic()
        authenticated = hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token)
        context = trace(self.headers if authenticated else {})
        self.observation_status = 503
        operation = self.path.strip("/").split("/", 1)[0]
        if not self.server.slots.acquire(blocking=False):
            self.reply(503, {"code": "parser_busy", "retryable": True})
            emit(context, self.observation_status, time.monotonic() - started, operation)
            return
        try:
            self.reply(200, self.dispatch())
        except ParseError as error:
            self.reply(error.status, error_response(error))
        except (ValueError, TypeError, UnicodeDecodeError):
            self.reply(400, {"code": "invalid_request", "retryable": False})
        except Exception:
            self.reply(503, {"code": "parser_failure", "retryable": True})
        finally:
            self.server.slots.release()
            emit(context, self.observation_status, time.monotonic() - started, operation)

    do_GET = handle_request
    do_POST = handle_request


def main():
    token = os.environ.get("PARSER_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("PARSER_TOKEN must contain at least 32 characters")
    settings = Settings.environment()
    try:
        versions = settings.versions()
    except (OSError, ValueError):
        raise SystemExit("Parser assets unavailable; run explicit model bootstrap and configure a readable font") from None
    supervisor = Supervisor(settings, versions)
    server = ThreadingHTTPServer(("0.0.0.0", integer("PARSER_PORT", 8090, 1, 65535)), Handler)
    server.daemon_threads = True
    server.token, server.supervisor, server.slots = token, supervisor, threading.BoundedSemaphore(16)

    def shutdown(_signal, _frame):
        supervisor.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        server.serve_forever()
    finally:
        supervisor.stop()
        server.server_close()


if __name__ == "__main__":
    main()
