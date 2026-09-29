"""Exercise archive rejection and replay without Docker or model downloads."""
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("asset_restore", Path(__file__).with_name("restore-assets.py"))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="inspector-assets-test-")
        self.root = Path(self.temp.name)
        self.target = self.root / "restored"
        self.path_patch = patch.object(restore, "Path", lambda value: self.root if value == "/release/assets" else Path(value))
        self.chown_patch = patch.object(restore.os, "chown", lambda *_: None, create=True)
        self.path_patch.start()
        self.chown_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.chown_patch.stop()
        self.temp.cleanup()

    def archive(self, name="model/weights", content=b"known-weights", symlink=False, expected=None):
        with tarfile.open(self.root / "models.tar", "w") as archive:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            if symlink:
                member.type = tarfile.SYMTYPE
                member.linkname = "../outside"
                archive.addfile(member)
            else:
                archive.addfile(member, io.BytesIO(content))
        (self.root / "models.json").write_text(json.dumps(expected if expected is not None else {name: hashlib.sha256(content).hexdigest()}))

    def test_exact_restore_replay_and_refusal_to_overwrite(self):
        self.archive()
        self.assertTrue(restore.restore("models", self.target, 1000, 1000)["verified"])
        self.assertTrue(restore.restore("models", self.target, 1000, 1000)["verified"])
        (self.target / "model/weights").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Existing asset differs"):
            restore.restore("models", self.target, 1000, 1000)

    def test_corruption_is_rejected_and_bad_file_not_retained(self):
        self.archive(expected={"model/weights": "a" * 64})
        with self.assertRaisesRegex(ValueError, "Restored asset differs"):
            restore.restore("models", self.target, 1000, 1000)
        self.assertFalse((self.target / "model/weights").exists())

    def test_traversal_and_links_cannot_escape_volume(self):
        self.archive(name="../outside")
        with self.assertRaisesRegex(ValueError, "Unsafe archive member"):
            restore.restore("models", self.target, 1000, 1000)
        self.assertFalse((self.root / "outside").exists())
        self.archive(symlink=True, expected={})
        with self.assertRaisesRegex(ValueError, "Unsafe archive member"):
            restore.restore("models", self.target, 1000, 1000)


if __name__ == "__main__":
    unittest.main()
