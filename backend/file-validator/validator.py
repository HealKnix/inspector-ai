"""Bounded structural admission only. No OCR, model calls or document execution."""
import json
import os
import pathlib
import resource
import subprocess
import sys
import tempfile
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from defusedxml.ElementTree import iterparse

ROOT = pathlib.Path(os.environ.get("QUARANTINE_ROOT", "/data/quarantine"))


def xml_check(source, relationships=False):
    depth = 0
    count = 0
    for event, element in iterparse(source, events=("start", "end"), forbid_dtd=True, forbid_entities=True, forbid_external=True):
        if event == "start":
            depth += 1
            count += 1
            if depth > 128 or count > 1_000_000:
                raise ValueError("XML resource limit")
            if relationships and element.attrib.get("TargetMode", "").lower() == "external":
                raise ValueError("External relationship")
        else:
            depth -= 1
            element.clear()


def inspect(path):
    if path.stat().st_size > 50_000_000:
        raise ValueError("File limit")
    with path.open("rb") as source:
        header = source.read(8)
    if header.startswith(b"%PDF-"):
        # qpdf exit 3 means successful parsing with recoverable warnings, not an
        # unsafe document. Errors still fail; both passes must finish before the
        # active-content checks below. The original bytes are never rewritten.
        subprocess.run(["qpdf", "--warning-exit-0", "--check", str(path)], check=True, timeout=25, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with tempfile.TemporaryFile() as output:
            subprocess.run(["qpdf", "--warning-exit-0", "--json", "--json-stream-data=none", str(path)], check=True, timeout=25, stdout=output, stderr=subprocess.DEVNULL)
            if output.tell() > 32_000_000:
                raise ValueError("PDF structure limit")
            output.seek(0)
            pdf = json.load(output)
        forbidden = {"/JS", "/JavaScript", "/AA", "/OpenAction", "/Launch", "/EmbeddedFiles", "/RichMedia", "/XFA", "/GoToR", "/SubmitForm", "/ImportData"}
        def walk(value):
            if isinstance(value, dict):
                if forbidden.intersection(value):
                    raise ValueError("Active PDF content")
                for item in value.values():
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
            elif isinstance(value, str) and value in forbidden:
                raise ValueError("Active PDF action")
        walk(pdf)
        if not pdf.get("pages"):
            raise ValueError("PDF has no pages")
        return "PDF"
    if header.startswith(b"PK"):
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if len(entries) > 10_000 or len(set(names)) != len(names) or not {"[Content_Types].xml", "word/document.xml", "_rels/.rels"}.issubset(names):
                raise ValueError("Invalid DOCX package")
            if sum(item.file_size for item in entries) > 250_000_000:
                raise ValueError("Expanded size limit")
            content_types = archive.read("[Content_Types].xml")
            if b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" not in content_types:
                raise ValueError("Invalid document type")
            for item in entries:
                name = item.filename.lower()
                if (item.flag_bits & 1 or "\\" in name or name.startswith("/") or ".." in pathlib.PurePosixPath(name).parts or ":" in name or
                    any(part in name for part in ["vbaproject", "activex", "embeddings/", ".exe", ".dll", ".js"]) or
                    item.file_size > 50_000_000 or item.file_size > max(1, item.compress_size) * 100):
                    raise ValueError("Unsafe ZIP entry")
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
            result = subprocess.run([sys.executable, __file__, data["key"]], timeout=60, capture_output=True, check=True)
            payload = result.stdout
            if len(payload) > 256:
                raise ValueError("Output limit")
            self.send_response(200)
        except Exception:
            payload = b'{"error":"unsafe_format"}'
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    if len(sys.argv) == 2:
        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (50, 50))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32_000_000, 32_000_000))
        print(json.dumps({"format": inspect(ROOT / str(uuid.UUID(sys.argv[1])))}))
    else:
        HTTPServer(("0.0.0.0", 8081), Handler).serve_forever()
