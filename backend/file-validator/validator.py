"""Bounded structural admission only. No OCR, model calls or document execution."""
import json
import os
import pathlib
import resource
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from xml.etree.ElementTree import ParseError
from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import iterparse

ROOT = pathlib.Path(os.environ.get("QUARANTINE_ROOT", "/data/quarantine"))


def validation_budget(value):
    if not isinstance(value, str):
        raise ValueError("Invalid FILE_VALIDATOR_TIMEOUT_SECONDS")
    value = value.strip()
    if not value.isascii() or not value.isdecimal():
        raise ValueError("Invalid FILE_VALIDATOR_TIMEOUT_SECONDS")
    seconds = int(value)
    if not 25 <= seconds <= 300:
        raise ValueError("Invalid FILE_VALIDATOR_TIMEOUT_SECONDS")
    return seconds


TIMEOUT_SECONDS = validation_budget(os.environ.get("FILE_VALIDATOR_TIMEOUT_SECONDS", "180"))


class DocumentRejected(Exception):
    """A document failed an explicit content or structural admission rule."""


def run_qpdf(arguments, deadline, output):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Validation deadline exceeded")
    # Exit 2 is ambiguous: qpdf also uses it for I/O and resource failures.
    # A tool failure cannot establish that the document is unsafe.
    subprocess.run(["qpdf", "--warning-exit-0", *arguments], check=True,
                   timeout=remaining, stdout=output, stderr=subprocess.DEVNULL)


def xml_check(source, relationships=False):
    depth = 0
    count = 0
    for event, element in iterparse(source, events=("start", "end"), forbid_dtd=True, forbid_entities=True, forbid_external=True):
        if event == "start":
            depth += 1
            count += 1
            if depth > 128 or count > 1_000_000:
                raise DocumentRejected("XML resource limit")
            if relationships and element.attrib.get("TargetMode", "").lower() == "external":
                raise DocumentRejected("External relationship")
        else:
            depth -= 1
            element.clear()


def inspect(path):
    deadline = time.monotonic() + TIMEOUT_SECONDS
    if path.stat().st_size > 50_000_000:
        raise DocumentRejected("File limit")
    with path.open("rb") as source:
        header = source.read(8)
    if header.startswith(b"%PDF-"):
        # qpdf exit 3 means successful parsing with recoverable warnings, not an
        # unsafe document. Errors still fail; both passes must finish before the
        # active-content checks below. The original bytes are never rewritten.
        run_qpdf(["--check", str(path)], deadline, subprocess.DEVNULL)
        with tempfile.TemporaryFile() as output:
            run_qpdf(["--json", "--json-stream-data=none", str(path)], deadline, output)
            if output.tell() > 32_000_000:
                raise DocumentRejected("PDF structure limit")
            output.seek(0)
            pdf = json.load(output)
        forbidden = {"/JS", "/JavaScript", "/AA", "/OpenAction", "/Launch", "/EmbeddedFiles", "/RichMedia", "/XFA", "/GoToR", "/SubmitForm", "/ImportData"}
        def walk(value):
            if isinstance(value, dict):
                if forbidden.intersection(value):
                    raise DocumentRejected("Active PDF content")
                for item in value.values():
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
            elif isinstance(value, str) and value in forbidden:
                raise DocumentRejected("Active PDF action")
        walk(pdf)
        if not pdf.get("pages"):
            raise DocumentRejected("PDF has no pages")
        return "PDF"
    if header.startswith(b"PK"):
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if len(entries) > 10_000 or len(set(names)) != len(names) or not {"[Content_Types].xml", "word/document.xml", "_rels/.rels"}.issubset(names):
                raise DocumentRejected("Invalid DOCX package")
            if sum(item.file_size for item in entries) > 250_000_000:
                raise DocumentRejected("Expanded size limit")
            content_types = archive.read("[Content_Types].xml")
            if b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" not in content_types:
                raise DocumentRejected("Invalid document type")
            for item in entries:
                name = item.filename.lower()
                if (item.flag_bits & 1 or "\\" in name or name.startswith("/") or ".." in pathlib.PurePosixPath(name).parts or ":" in name or
                    any(part in name for part in ["vbaproject", "activex", "embeddings/", ".exe", ".dll", ".js"]) or
                    item.file_size > 50_000_000 or item.file_size > max(1, item.compress_size) * 100):
                    raise DocumentRejected("Unsafe ZIP entry")
                # Reading to EOF verifies the ZIP CRC without extracting paths.
                with archive.open(item) as source:
                    if name.endswith((".xml", ".rels")):
                        xml_check(source, name.endswith(".rels"))
                    else:
                        while source.read(65536):
                            pass
        return "DOCX"
    with path.open("rb") as source:
        xml_check(source)
    return "XML"


def inspect_result(path):
    try:
        started = time.monotonic()
        result = inspect(path)
        if time.monotonic() - started > TIMEOUT_SECONDS:
            raise TimeoutError("Validation deadline exceeded")
        return {"format": result}
    except (DocumentRejected, ParseError, DefusedXmlException, zipfile.BadZipFile):
        return {"error": "unsafe_format"}
    except Exception:
        # Do not disclose document content, tool stderr or filesystem paths.
        return {"error": "validator_unavailable"}


def worker_response(key):
    process = subprocess.Popen([sys.executable, __file__, key],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               start_new_session=True)
    try:
        output, _ = process.communicate(timeout=TIMEOUT_SECONDS + 5)
        if process.returncode != 0 or len(output) > 256:
            raise RuntimeError("Validator worker failed")
        result = json.loads(output)
        if result in ({"format": "PDF"}, {"format": "DOCX"}, {"format": "XML"},
                      {"error": "unsafe_format"}):
            return 200, result
        if result == {"error": "validator_unavailable"}:
            return 503, result
        raise RuntimeError("Invalid validator worker response")
    finally:
        # Kill the whole session, including qpdf if the worker crashed/timed out.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        if process.stdout is not None:
            process.stdout.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Documents, names and untrusted parser messages never enter logs.

    def do_POST(self):
        self.connection.settimeout(5)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 256:
                raise ValueError("Body limit")
            data = json.loads(self.rfile.read(length))
            if set(data) != {"key"} or str(uuid.UUID(data["key"])) != data["key"]:
                raise ValueError("Invalid handle")
            status, result = worker_response(data["key"])
        except Exception:
            status, result = 503, {"error": "validator_unavailable"}
        payload = json.dumps(result).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    if len(sys.argv) == 2:
        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_SECONDS + 1, TIMEOUT_SECONDS + 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32_000_000, 32_000_000))
        print(json.dumps(inspect_result(ROOT / str(uuid.UUID(sys.argv[1])))))
    else:
        HTTPServer(("0.0.0.0", 8081), Handler).serve_forever()
