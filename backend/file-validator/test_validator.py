"""Run in the validator image: python -m unittest discover -s /tests -v."""
import http.client
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import uuid
import zipfile
from xml.etree.ElementTree import ParseError

import validator


class ValidationTests(unittest.TestCase):
    def test_budget_is_bounded_and_rejects_invalid_configuration(self):
        for value in ("25", "180", "300", " 180 "):
            self.assertEqual(validator.validation_budget(value), int(value))
        for value in ("", "24", "301", "-1", "1.5", "NaN", "Infinity", "１８０"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validator.validation_budget(value)

    def test_technical_failures_never_accuse_the_document(self):
        errors = [subprocess.TimeoutExpired("qpdf", 180),
                  subprocess.CalledProcessError(2, "qpdf"),
                  subprocess.CalledProcessError(-signal.SIGKILL, "qpdf"),
                  FileNotFoundError("qpdf missing"), PermissionError(),
                  MemoryError(), OSError("resource limit"), ValueError("internal bug"),
                  json.JSONDecodeError("bad tool output", "", 0)]
        for error in errors:
            with self.subTest(error=type(error).__name__), patch.object(validator, "inspect", side_effect=error):
                self.assertEqual(validator.inspect_result(Path("unused")),
                                 {"error": "validator_unavailable"})

    def test_confirmed_document_rejections_keep_unsafe_format(self):
        for error in (validator.DocumentRejected(), ParseError(),
                      validator.DefusedXmlException(), zipfile.BadZipFile()):
            with self.subTest(error=type(error).__name__), patch.object(validator, "inspect", side_effect=error):
                self.assertEqual(validator.inspect_result(Path("unused")),
                                 {"error": "unsafe_format"})

    def test_real_xml_and_invalid_or_active_xml(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input"
            for contents, expected in ((b"<synthetic/>", {"format": "XML"}),
                                       (b"not a document", {"error": "unsafe_format"}),
                                       (b'<!DOCTYPE root [<!ENTITY x "x">]><root>&x;</root>',
                                        {"error": "unsafe_format"})):
                source.write_bytes(contents)
                self.assertEqual(validator.inspect_result(source), expected)

    def test_pdf_passes_share_one_deadline_and_keep_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input"
            original = b"%PDF-synthetic-input"
            source.write_bytes(original)

            def qpdf(arguments, **options):
                if "--json" in arguments:
                    options["stdout"].write(b'{"pages":[{}]}')
                return subprocess.CompletedProcess(arguments, 0)

            with patch.object(validator, "TIMEOUT_SECONDS", 180), \
                    patch.object(validator.time, "monotonic", side_effect=[100, 105, 135]), \
                    patch.object(validator.subprocess, "run", side_effect=qpdf) as run:
                self.assertEqual(validator.inspect(source), "PDF")
            self.assertEqual([call.kwargs["timeout"] for call in run.call_args_list], [175, 145])
            self.assertTrue(all(call.kwargs["check"] for call in run.call_args_list))
            self.assertTrue(all("--warning-exit-0" in call.args[0] for call in run.call_args_list))
            self.assertEqual(source.read_bytes(), original)

    def test_expired_deadline_does_not_launch_another_qpdf(self):
        with patch.object(validator.time, "monotonic", return_value=180), \
                patch.object(validator.subprocess, "run") as run:
            with self.assertRaises(TimeoutError):
                validator.run_qpdf(["--check", "unused"], 180, subprocess.DEVNULL)
        run.assert_not_called()

    def test_active_pdf_is_rejected_after_both_qpdf_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input"
            source.write_bytes(b"%PDF-synthetic-input")
            for marker in ("/JavaScript", "/OpenAction", "/Launch", "/EmbeddedFiles"):
                def qpdf(arguments, **options):
                    if "--json" in arguments:
                        options["stdout"].write(json.dumps({"pages": [{}], "objects": {marker: {}}}).encode())
                    return subprocess.CompletedProcess(arguments, 0)
                with self.subTest(marker=marker), patch.object(validator.subprocess, "run", side_effect=qpdf) as run:
                    self.assertEqual(validator.inspect_result(source), {"error": "unsafe_format"})
                    self.assertEqual(run.call_count, 2)

    def test_work_finishing_after_deadline_is_not_accepted(self):
        with patch.object(validator, "inspect", return_value="PDF"), \
                patch.object(validator.time, "monotonic", side_effect=[0, 181]), \
                patch.object(validator, "TIMEOUT_SECONDS", 180):
            self.assertEqual(validator.inspect_result(Path("unused")), {"error": "validator_unavailable"})


class SupervisorTests(unittest.TestCase):
    def process(self, output=b'{"format":"PDF"}', returncode=0):
        process = Mock(pid=12345, returncode=returncode)
        process.communicate.return_value = (output, None)
        return process

    def test_timeout_kills_worker_and_qpdf_group(self):
        process = self.process()
        process.communicate.side_effect = subprocess.TimeoutExpired("worker", 185)
        with patch.object(validator.subprocess, "Popen", return_value=process) as popen, \
                patch.object(validator.os, "killpg") as kill, \
                patch.object(validator, "TIMEOUT_SECONDS", 180):
            with self.assertRaises(subprocess.TimeoutExpired):
                validator.worker_response(str(uuid.uuid4()))
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        process.communicate.assert_called_once_with(timeout=185)
        kill.assert_called_once_with(12345, signal.SIGKILL)
        process.wait.assert_called_once()

    def test_worker_exit_signal_and_invalid_output_are_technical_failures(self):
        for output, code in ((b"", -9), (b"", 1), (b"garbage", 0),
                             (b'{"format":"PDF","error":"unsafe_format"}', 0),
                             (b'{"format":"UNKNOWN"}', 0), (b"x" * 257, 0)):
            process = self.process(output, code)
            with self.subTest(output=output, code=code), \
                    patch.object(validator.subprocess, "Popen", return_value=process), \
                    patch.object(validator.os, "killpg"), \
                    self.assertRaises(json.JSONDecodeError if output == b"garbage" else RuntimeError):
                validator.worker_response(str(uuid.uuid4()))

    def test_known_worker_verdicts_have_distinct_http_status(self):
        for payload, status in (({"format": "PDF"}, 200),
                                ({"error": "unsafe_format"}, 200),
                                ({"error": "validator_unavailable"}, 503)):
            with self.subTest(payload=payload), \
                    patch.object(validator.subprocess, "Popen", return_value=self.process(json.dumps(payload).encode())), \
                    patch.object(validator.os, "killpg", side_effect=ProcessLookupError):
                self.assertEqual(validator.worker_response(str(uuid.uuid4())), (status, payload))

    def test_real_child_process_reports_missing_file_as_unavailable(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"QUARANTINE_ROOT": directory}):
            key = str(uuid.uuid4())
            self.assertEqual(validator.worker_response(key), (503, {"error": "validator_unavailable"}))
            (Path(directory) / key).write_bytes(b"<synthetic/>")
            self.assertEqual(validator.worker_response(key), (200, {"format": "XML"}))
            (Path(directory) / key).write_bytes(b"invalid document")
            self.assertEqual(validator.worker_response(key), (200, {"error": "unsafe_format"}))

    def test_http_timeout_returns_unavailable_without_document_or_tool_details(self):
        server = validator.HTTPServer(("127.0.0.1", 0), validator.Handler)
        thread = threading.Thread(target=server.handle_request)
        with patch.object(validator, "worker_response", side_effect=subprocess.TimeoutExpired("secret-path", 185)):
            thread.start()
            connection = http.client.HTTPConnection(*server.server_address, timeout=5)
            try:
                connection.request("POST", "/", json.dumps({"key": str(uuid.uuid4())}),
                                   {"Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status, 503)
                self.assertEqual(json.loads(response.read()), {"error": "validator_unavailable"})
            finally:
                connection.close()
                thread.join(timeout=5)
                server.server_close()


if __name__ == "__main__":
    unittest.main()
