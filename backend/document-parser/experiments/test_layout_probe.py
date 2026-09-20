"""Layout runner boundaries; synthetic pixels and fake predictor only, no OCR."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image

import layout_probe
from layout_probe import BASELINE, MODEL, digest, execute_bounded, infer_page, validate_manifest, write_json


class LayoutProbeTests(unittest.TestCase):
    def manifest(self, root):
        image = root / "original.png"
        Image.new("RGB", (30, 20), (10, 20, 30)).save(image)
        truth = root / "truth.json"
        truth.write_text('{"synthetic":true}', encoding="utf-8")
        value = {"schema_version": 1, "truth_path": str(truth), "truth_sha256": digest(truth), "pages": [
            {"id": "synthetic-1", "image_path": str(image), "image_sha256": digest(image),
             "source_sha256": "a" * 64, "page_number": 1, "split": "holdout"}]}
        path = root / "manifest.json"
        write_json(path, value)
        return path, value

    def test_manifest_requires_truth_and_immutable_pngs_before_predictor(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, manifest = self.manifest(root)
            self.assertEqual(validate_manifest(path), manifest)
            for field in ("truth_sha256", "image_sha256"):
                broken = copy.deepcopy(manifest)
                (broken if field == "truth_sha256" else broken["pages"][0])[field] = "0" * 64
                write_json(path, broken)
                with self.assertRaisesRegex(ValueError, "mismatch"):
                    validate_manifest(path)
            manifest["pages"].append(copy.deepcopy(manifest["pages"][0]))
            write_json(path, manifest)
            with self.assertRaisesRegex(ValueError, "repeated"):
                validate_manifest(path)

    def test_hash_verification_rejects_paths_inside_git(self):
        from ppstructure_probe import REPO
        with self.assertRaisesRegex(ValueError, "outside"):
            layout_probe.checked_file(REPO / "private.png", "0" * 64)

    def test_baseline_matches_pinned_layout_configuration(self):
        self.assertEqual(BASELINE["threshold"], {i: {0: .3, 2: .4, 7: .3, 15: .45}.get(i, .5) for i in range(20)})
        self.assertEqual([i for i, mode in BASELINE["layout_merge_bboxes_mode"].items() if mode == "large"], [0, 1, 7, 16])
        self.assertTrue(BASELINE["layout_nms"])
        self.assertEqual(BASELINE["layout_unclip_ratio"], [1., 1.])
        self.assertEqual(len(layout_probe.LABELS), 20)
        self.assertEqual(layout_probe.LABELS[8], "table")

    def test_inference_uses_original_unmasked_bgr_and_preserves_raw_labels(self):
        class FakeLayout:
            def predict(self, pixels):
                self.pixels = pixels.copy()
                return [SimpleNamespace(json={"res": {"boxes": [
                    {"cls_id": 2, "label": "text", "score": .75, "coordinate": [2., 3., 20., 15.]}]}})]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            _, manifest = self.manifest(root)
            engine = FakeLayout()
            metadata = infer_page(engine, manifest["pages"][0], root)
            self.assertEqual(engine.pixels.shape, (20, 30, 3))
            self.assertTrue((engine.pixels == [30, 20, 10]).all())
            self.assertEqual(metadata["boxes"], 1)
            evidence = json.loads((root / "synthetic-1.json").read_text())
            self.assertEqual(evidence["boxes"][0]["coordinate"], [2., 3., 20., 15.])
            self.assertEqual(evidence["coordinate_space"], "original-render-pixels")
            self.assertEqual(evidence["orientation_applied"], 0)
            self.assertTrue((root / "synthetic-1.overlay.png").is_file())

    def test_offline_environment_disallows_connections_before_paddle_import(self):
        command = [sys.executable, "-B", "-c", "from pathlib import Path; from layout_probe import environment; import socket; environment(Path('.'), True); socket.create_connection(('127.0.0.1',9))"]
        process = subprocess.run(command, cwd=Path(__file__).parent, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("Experiment inference is offline", process.stderr)

    def test_layout_assets_are_compared_to_pinned_production_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            model = root / MODEL
            model.mkdir()
            for name in layout_probe.ASSETS:
                (model / name).write_bytes(b"wrong synthetic model")
            with self.assertRaisesRegex(ValueError, "pinned"):
                layout_probe.model_assets(root)

    @unittest.skipUnless(os.name == "nt", "Windows kernel cap test; Linux uses Docker memory cgroup")
    def test_supervisor_memory_cap_is_installed_before_worker_gate_opens(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ready = root / "started"
            uncapped = root / "uncapped"
            script = ("import sys,pathlib; assert sys.stdin.readline().strip()=='RUN'; "
                      "pathlib.Path(sys.argv[1]).write_text('started'); "
                      "allocation=bytearray(256*1024*1024); pathlib.Path(sys.argv[2]).write_text('bad')")
            status, code = execute_bounded([sys.executable, "-B", "-c", script, str(ready), str(uncapped)], root, 10, 64 * 1024 ** 2)
            self.assertTrue(ready.exists())
            self.assertFalse(uncapped.exists())
            self.assertNotEqual(code, 0)
            self.assertNotEqual(status, "complete")
            self.assertIn("MemoryError", (root / "process.log").read_text())

    @unittest.skipUnless(os.name == "nt", "Parent must run Linux probe inside capped Docker")
    def test_timeout_stops_child_without_late_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            late = root / "late"
            script = "import sys,time,pathlib; sys.stdin.readline(); time.sleep(2); pathlib.Path(sys.argv[1]).write_text('bad')"
            status, code = execute_bounded([sys.executable, "-B", "-c", script, str(late)], root, .5)
            self.assertEqual(status, "timeout-killed")
            self.assertNotEqual(code, 0)
            time.sleep(2)
            self.assertFalse(late.exists())


if __name__ == "__main__":
    unittest.main()
