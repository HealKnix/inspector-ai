"""Small boundary checks; no models or real documents required."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import ppstructure_probe
from ppstructure_probe import ASSETS, SafeTable, REPO, digest, execute_bounded, outside_repo, run, verified_assets


class ProbeBoundaryTests(unittest.TestCase):
    def test_frozen_baseline_keeps_original_orientation_and_plain_ocr_api(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from legacy_ocr import LocalOCR
        from PIL import Image
        class Orientation:
            def predict(self, _image):
                return [SimpleNamespace(json={"res": {"label_names": ["270", "90", "0", "180"], "scores": [.9, .05, .03, .02]}})]
        class PlainOCR:
            def predict(self, _image):
                return [SimpleNamespace(json={"res": {"rec_texts": ["−40"], "rec_scores": [.9],
                    "rec_polys": [[[40, 10], [60, 10], [60, 30], [40, 30]]], "dt_polys": [[1]]}})]
        reader = LocalOCR.__new__(LocalOCR)
        reader.orientation, reader.engine = Orientation(), PlainOCR()
        blocks, angle, detected = reader.recognize(Image.new("RGB", (100, 200), "white"))
        self.assertEqual((angle, detected), (270, 1))
        self.assertEqual(blocks[0]["raw_text"], "−40")
        self.assertEqual(blocks[0]["bbox"], [.1, .7, .3, .8])
        self.assertEqual(blocks[0]["kind"], "text")

    def test_table_preview_whitelist_preserves_empty_cells_unicode_and_spans(self):
        table = SafeTable()
        table.feed('<table style="background:url(https://example.invalid)"><tr>'
                   '<td rowspan="2" onclick="alert(1)">−40 °C<script>alert(1)</script></td>'
                   '<td colspan="3"></td><td><img src="https://example.invalid">ХВС-150/1 &amp; A</td>'
                   '</tr></table>')
        self.assertEqual("".join(table.parts), '<table><tr><td rowspan="2">−40 °C</td>'
                         '<td colspan="3"></td><td>ХВС-150/1 &amp; A</td></tr></table>')
        self.assertEqual([cell["text"] for cell in table.rows[0]], ["−40 °C", "", "ХВС-150/1 & A"])
        self.assertEqual(table.rows[0][0]["rowspan"], 2)
        self.assertEqual(table.rows[0][1]["colspan"], 3)

    def test_rejects_repository_output(self):
        for path in (REPO, REPO / "ignored-private-output"):
            with self.assertRaises(ValueError):
                outside_repo(path)
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(outside_repo(folder), Path(folder).resolve())

    def test_timeout_really_stops_child_before_late_write(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            late = output / "late.txt"
            ready = output / "ready.txt"
            command = [sys.executable, "-c", "import time,pathlib,sys; pathlib.Path(sys.argv[2]).write_text('started'); time.sleep(1); pathlib.Path(sys.argv[1]).write_text('alive')", str(late), str(ready)]
            status, code = execute_bounded(command, output, .5)
            self.assertEqual(status, "timeout-killed")
            self.assertNotEqual(code, 0)
            self.assertTrue(ready.exists(), "Child must actually have started before the timeout")
            time.sleep(1)
            self.assertFalse(late.exists())
            self.assertEqual(json.loads((output / "supervisor.json").read_text())["status"], "timeout-killed")

    def test_offline_network_guard_runs_in_separate_process(self):
        script = ("from pathlib import Path; import socket; from ppstructure_probe import environment; "
                  "environment(Path('.'), True); socket.create_connection(('127.0.0.1', 9))")
        process = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parent,
                                 capture_output=True, text=True, timeout=10)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("Experiment inference is offline", process.stderr)

    def test_existing_outputs_are_never_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "result.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "nonempty"):
                run(SimpleNamespace(output=folder))

    def test_selected_model_assets_need_complete_pinned_and_local_manifests(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            model = root / "models" / "synthetic-model"
            model.mkdir(parents=True)
            for name in ASSETS:
                (model / name).write_bytes(b"synthetic model fixture")
            assets = {f"synthetic-model/{name}": digest(model / name) for name in ASSETS}
            (root / "model-lock.json").write_text(json.dumps(assets))
            (root / "model-manifest.json").write_text(json.dumps(assets))
            with patch.object(ppstructure_probe, "__file__", str(root / "runner.py")):
                self.assertEqual(verified_assets(root, {"synthetic-model"}), assets)
                (root / "model-manifest.json").write_text("{}")
                with self.assertRaisesRegex(ValueError, "Every selected"):
                    verified_assets(root, {"synthetic-model"})
                (root / "model-manifest.json").write_text(json.dumps(assets))
                (model / ASSETS[0]).write_bytes(b"changed model")
                with self.assertRaisesRegex(ValueError, "mismatch"):
                    verified_assets(root, {"synthetic-model"})


if __name__ == "__main__":
    unittest.main()
