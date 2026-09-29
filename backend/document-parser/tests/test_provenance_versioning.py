"""Preserve table-link identity and isolate caches across the fusion release."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf

from common import block, finalize_page
from config import Settings, fingerprint
from pipeline import parse


def cell(text, row, column, **extra):
    return block(text, [.1, .1, .4, .2], "native", table_id="source-table",
                 row=row, column=column, row_span=1, column_span=1, **extra)


def linked_text(rows=(1,), columns=(0, 1)):
    return block("SYNTHETIC MATERIAL", [.1, .1, .6, .2], "native", native_valid=True,
                 table_link={"schema_version": 1, "status": "associated", "table_id": "source-table",
                             "rows": list(rows), "columns": list(columns), "reasons": []})


class NativeOnly:
    def layout(self, image):
        return [{"label": "text", "score": .99, "coordinate": [0, 0, image.width, image.height]}]

    def detect_lines(self, _image):
        return []

    def recognize_lines(self, *_):
        raise AssertionError("A native-only document must not invoke recognition")


class ProvenanceVersioningTests(unittest.TestCase):
    def test_cross_column_link_resolves_to_displayed_grid(self):
        page = finalize_page({"page_number": 3, "reasons": [], "blocks": [
            linked_text(), cell("designation", 1, 0), cell("material", 1, 1), cell("50", 1, 2)]})
        link = page["blocks"][0]["table_link"]
        self.assertEqual(link["status"], "associated")
        self.assertEqual(link["table_id"], page["blocks"][2]["table_id"])
        self.assertEqual(link["table_id"], "p3-t1-part1")
        self.assertEqual(page["blocks"][0]["raw_text"], "SYNTHETIC MATERIAL")

    def test_link_cannot_choose_between_overlapping_table_parts(self):
        page = finalize_page({"page_number": 1, "reasons": [], "blocks": [
            linked_text(columns=(0,)), cell("first", 1, 0), cell("second", 1, 0)]})
        link = page["blocks"][0]["table_link"]
        self.assertIsNone(link["table_id"])
        self.assertEqual(link["status"], "ambiguous")
        self.assertIn("TABLE_LINK_MULTIPLE_PARTS", link["reasons"])
        self.assertEqual(len({c["table_id"] for c in page["blocks"][1:]}), 2)

    def test_missing_target_is_not_a_confirmed_row_association(self):
        page = finalize_page({"page_number": 1, "reasons": [], "blocks": [linked_text(), cell("only", 1, 0)]})
        self.assertIsNone(page["blocks"][0]["table_link"]["table_id"])
        self.assertIn("TABLE_LINK_TARGET_UNRESOLVED", page["reasons"])

    def test_legacy_blocks_do_not_gain_invented_provenance(self):
        source = block("LEGACY", [.1, .1, .2, .2], "native")
        result = finalize_page({"page_number": 1, "reasons": [], "blocks": [copy.deepcopy(source)]})
        for field in ("provenance", "native_valid", "table_link"):
            self.assertNotIn(field, result["blocks"][0])

    def test_upgrade_and_rollback_keep_source_old_checkpoint_and_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "originals").mkdir()
            (root / "derived").mkdir()
            original = pymupdf.open()
            original.new_page().insert_text((50, 100), "SYNTHETIC NATIVE TEXT 50 m3")
            data = original.tobytes()
            original.close()
            source_hash = hashlib.sha256(data).hexdigest()
            key = str(uuid.uuid4())
            source = root / "originals" / key
            source.write_bytes(data)
            request = {"schema_version": 1, "request_id": str(uuid.uuid4()), "storage_key": key,
                       "source_sha256": source_hash, "format": "pdf"}
            settings = Settings(root, root, Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
            previous = {"parser": "par-local-1", "renderer": "synthetic", "pdf_region_profile": "paddle-regions-v1"}
            current = {**previous, "parser": "par-local-2", "pdf_region_profile": "paddle-regions-v2",
                       "text_provenance": "par-text-provenance-v1"}
            old = parse(request, settings, previous, NativeOnly(), lambda *_: None)
            old_checkpoint = root / "derived" / ".parser-checkpoints" / source_hash / fingerprint(previous) / "1.json"
            # Emulate a genuine older checkpoint with absent additive metadata.
            wrapped = json.loads(old_checkpoint.read_text())
            for item in wrapped["page"]["blocks"]:
                for field in ("native_valid", "provenance", "table_link"):
                    item.pop(field, None)
            serialized = json.dumps(wrapped["page"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            wrapped["metadata_sha256"] = hashlib.sha256(serialized.encode()).hexdigest()
            old_checkpoint.write_text(json.dumps(wrapped, ensure_ascii=False), encoding="utf-8")
            checkpoint_bytes = old_checkpoint.read_bytes()
            old_artifact = json.dumps(old, sort_keys=True)
            upgraded = parse(request, settings, current, NativeOnly(), lambda *_: None)
            repeated = parse(request, settings, current, NativeOnly(), lambda *_: None)
            rollback = parse(request, settings, previous, NativeOnly(), lambda *_: None)
            self.assertNotEqual(old["pipeline_fingerprint"], upgraded["pipeline_fingerprint"])
            self.assertNotEqual(old["pages"][0]["image_key"], upgraded["pages"][0]["image_key"])
            self.assertEqual(upgraded["pages"][0]["image_key"], repeated["pages"][0]["image_key"])
            self.assertEqual(old["pages"][0]["image_key"], rollback["pages"][0]["image_key"])
            self.assertEqual(upgraded["text_provenance_schema_version"], 1)
            self.assertEqual(old_checkpoint.read_bytes(), checkpoint_bytes)
            self.assertEqual(json.dumps(old, sort_keys=True), old_artifact)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), source_hash)
            for item in rollback["pages"][0]["blocks"]:
                self.assertNotIn("native_valid", item)


if __name__ == "__main__":
    unittest.main()
