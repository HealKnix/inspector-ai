"""Disposable integration fixture: real private HTTP handler + native XML parser.

No OCR models or production originals. The supervisor's scheduling is excluded:
that behavior has its own tests; this probe verifies the tracing boundary and
real native artifact production against shared synthetic storage.
"""
import hashlib
import os
from pathlib import Path
import sys
import threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import Settings, fingerprint
from pipeline import parse
from server import Handler

root = Path("/probe/storage")
font = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
settings = Settings(root, root, font)
versions = {"renderer": "synthetic-native-observability", "font_sha256": hashlib.sha256(font.read_bytes()).hexdigest()}


class NativeXMLSupervisor:
    def health(self):
        return {"status": "ok", "pipeline_fingerprint": fingerprint(versions), "versions": versions}

    def run(self, request):
        if request["format"] != "xml":
            raise ValueError("Synthetic probe only accepts XML")
        return parse(request, settings, versions, None, lambda *_: None)

    def cancel(self, _request_id):
        return {"cancelled": False}


server = ThreadingHTTPServer(("0.0.0.0", 8090), Handler)
server.token = os.environ["PARSER_TOKEN"]
server.supervisor = NativeXMLSupervisor()
server.slots = threading.BoundedSemaphore(4)
server.serve_forever()
