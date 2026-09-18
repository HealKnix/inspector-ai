"""Synthetic contract/geometry/security cases. No customer files enter this suite."""
import hashlib
import io
import json
import os
from pathlib import Path
from dataclasses import replace
import sys
import tempfile
import threading
import time
import unittest
import uuid
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf
from PIL import Image, ImageDraw

from common import ParseError, block, normalize
from config import Settings
from ocr import LocalOCR, unrotate_point
from pipeline import parse, validate_request
from server import Supervisor
from structured import docx_items, xml_items
from tables import structure_tables


class NoOCR:
    def recognize(self, _image):
        raise AssertionError("Native or blank page must not invoke OCR")


class ImageOCR:
    def __init__(self):
        self.calls = 0

    def recognize(self, image):
        self.calls += 1
        assert image.width == 300 and image.height == 120
        return [block("SYNTHETIC IMAGE TEXT", [.1, .2, .9, .6], "ocr")], 0, 1


class Result:
    def __init__(self, value):
        self.json = {"res": value}


class OrientationStub:
    def __init__(self, scores):
        self.scores = scores

    def predict(self, _image):
        return [Result({"label_names": ["270", "90", "0", "180"], "scores": self.scores})]


class OCRStub:
    def __init__(self):
        self.calls = 0

    def predict(self, _image):
        self.calls += 1
        return [Result({"rec_texts": ["SYNTHETIC"], "rec_scores": [.9],
                        "rec_polys": [[[40, 10], [60, 10], [60, 30], [40, 30]]], "dt_polys": [[1]]})]


def busy_worker(connection, _settings, _versions):
    connection.send({"type": "ready"})
    while True:
        connection.recv()
        while True:
            sum(range(10000))


class ParserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / "originals").mkdir()
        (root / "derived").mkdir()
        font = Path(os.environ.get("PARSER_FONT_PATH", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
        if not font.is_file() and os.name == "nt":
            font = Path("C:/Windows/Fonts/arial.ttf")
        self.settings = Settings(root, root, font, timeout=1)
        self.versions = {"renderer": "synthetic-test", "font_sha256": hashlib.sha256(font.read_bytes()).hexdigest()}

    def tearDown(self):
        self.temp.cleanup()

    def request(self, data, format="pdf"):
        key = str(uuid.uuid4())
        (self.settings.storage / "originals" / key).write_bytes(data)
        return {"schema_version": 1, "request_id": str(uuid.uuid4()), "storage_key": key,
                "source_sha256": hashlib.sha256(data).hexdigest(), "format": format}

    def test_normalization_does_not_correct_signs_or_case(self):
        self.assertEqual(normalize("  ШИФР\t А-01/РД+№5  \n е\u0308  ≠  Е  "), "ШИФР А-01/РД+№5\nё ≠ Е")

    def test_native_crop_rotate_and_inverse_correspond_to_pixels(self):
        measured_ious = {}

        def rectangle_iou(left, right):
            intersection = max(0, min(left[2], right[2]) - max(left[0], right[0])) * max(0, min(left[3], right[3]) - max(left[1], right[1]))
            left_area = (left[2] - left[0]) * (left[3] - left[1])
            right_area = (right[2] - right[0]) * (right[3] - right[1])
            return intersection / (left_area + right_area - intersection)

        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                document = pymupdf.open()
                page = document.new_page(width=420, height=320)
                page.insert_text((130, 120), "NATIVE TEST", fontsize=18)
                page.set_cropbox(pymupdf.Rect(80, 60, 360, 280))
                page.set_rotation(rotation)
                artifact = parse(self.request(document.tobytes()), self.settings, self.versions, NoOCR(), lambda *_: None)
                parsed = artifact["pages"][0]
                self.assertEqual(parsed["quality"], "OK")
                self.assertEqual(parsed["blocks"][0]["raw_text"], "NATIVE TEST")
                with Image.open(self.settings.storage / "derived" / parsed["image_key"]) as image:
                    self.assertEqual(image.size, (parsed["width"], parsed["height"]))
                    a, b, c, d = parsed["blocks"][0]["bbox"]
                    region = image.crop((a * image.width, b * image.height, c * image.width, d * image.height)).convert("L")
                    self.assertLess(region.getextrema()[0], 50)
                    # All dark glyph pixels must be inside the block rectangle (allow raster rounding).
                    import numpy as np
                    yy, xx = np.where(np.array(image.convert("L")) < 150)
                    self.assertGreaterEqual(xx.min(), int(a * image.width) - 2)
                    self.assertLessEqual(xx.max(), int(c * image.width) + 2)
                    self.assertGreaterEqual(yy.min(), int(b * image.height) - 2)
                    self.assertLessEqual(yy.max(), int(d * image.height) + 2)
                    ink_bbox = (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1)
                    reported_bbox = (a * image.width, b * image.height, c * image.width, d * image.height)
                    measured_ious[rotation] = rectangle_iou(ink_bbox, reported_bbox)
                    # The pinned Helvetica fixture measures about .545: its line
                    # box includes ascent/descent whitespace around uppercase ink.
                    # A .50 floor allows raster rounding but rejects oversized boxes;
                    # a page-sized highlight would satisfy containment alone.
                    self.assertGreaterEqual(measured_ious[rotation], .50)
                    self.assertLess(rectangle_iou(ink_bbox, (0, 0, image.width, image.height)), .50)
                forward = pymupdf.Matrix(parsed["transform"]["pdf_to_visible"])
                inverse = pymupdf.Matrix(parsed["transform"]["visible_to_pdf"])
                restored = pymupdf.Point(140, 130) * forward * inverse
                self.assertAlmostEqual(restored.x, 140, places=4)
                self.assertAlmostEqual(restored.y, 130, places=4)
                # Original PDF baseline is (130, 320-120), independent of CropBox/Rotate.
                actual = pymupdf.Point(130, 200) * forward
                expected = pymupdf.Point(50, 60) * page.rotation_matrix
                self.assertAlmostEqual(actual.x, expected.x, places=4)
                self.assertAlmostEqual(actual.y, expected.y, places=4)
                normalized = pymupdf.Point(130, 200) * pymupdf.Matrix(parsed["transform"]["pdf_to_normalized"])
                a, b, c, d = parsed["blocks"][0]["bbox"]
                self.assertTrue(a - 1e-6 <= normalized.x <= c + 1e-6 and b - 1e-6 <= normalized.y <= d + 1e-6)
        print("synthetic_crop_rotate_ink_bbox_iou=" + json.dumps({"by_rotation": measured_ious, "minimum": min(measured_ious.values()), "threshold": .50}), flush=True)

    def test_blank_page_abstains_and_counts_coverage(self):
        document = pymupdf.open()
        document.new_page()
        artifact = parse(self.request(document.tobytes()), self.settings, self.versions, NoOCR(), lambda *_: None)
        self.assertEqual(artifact["quality"], "ABSTAIN")
        self.assertEqual(artifact["coverage"], {"total_pages": 1, "readable_pages": 0, "unreadable_pages": 1})

    def test_small_raster_omission_is_explicit(self):
        document = pymupdf.open()
        page = document.new_page(width=400, height=400)
        page.insert_text((50, 80), "SYNTHETIC NATIVE")
        payload = io.BytesIO()
        Image.new("RGB", (10, 10), "black").save(payload, "PNG")
        page.insert_image(pymupdf.Rect(200, 200, 205, 205), stream=payload.getvalue())
        result = parse(self.request(document.tobytes()), self.settings, self.versions, NoOCR(), lambda *_: None)
        self.assertEqual(result["quality"], "LOW_QUALITY")
        self.assertIn("RASTER_SMALL_REGION_UNREADABLE", result["reasons"])
        self.assertEqual(len(result["pages"][0]["transform"]["unprocessed_regions"]), 1)

    def test_mixed_pdf_keeps_native_and_maps_ocr_crop_to_same_page(self):
        class CropOCR:
            def recognize(self, _image):
                item = block("SYNTHETIC SCAN", [.1, .2, .9, .6], "ocr")
                item["confidence"] = .9
                return [item], 0, 1
        document = pymupdf.open()
        page = document.new_page(width=400, height=400)
        page.insert_text((50, 80), "SYNTHETIC NATIVE")
        payload = io.BytesIO()
        raster = Image.new("RGB", (300, 120), "white")
        ImageDraw.Draw(raster).text((30, 30), "SYNTHETIC SCAN", fill="black")
        raster.save(payload, "PNG")
        page.insert_image(pymupdf.Rect(50, 200, 350, 320), stream=payload.getvalue())
        result = parse(self.request(document.tobytes()), self.settings, self.versions, CropOCR(), lambda *_: None)
        self.assertIn("SYNTHETIC NATIVE", result["raw_text"])
        self.assertIn("SYNTHETIC SCAN", result["raw_text"])
        ocr = next(item for item in result["pages"][0]["blocks"] if item["source"] == "ocr")
        self.assertAlmostEqual(ocr["bbox"][0], .2, places=2)
        self.assertAlmostEqual(ocr["bbox"][1], .56, places=2)

    def test_native_header_does_not_hide_vector_outline_content(self):
        class VectorOCR:
            calls = 0
            def recognize(self, _image):
                self.calls += 1
                item = block("SYNTHETIC VECTOR", [.1, .5, .8, .7], "ocr")
                item["confidence"] = .9
                return [item], 0, 1
        document = pymupdf.open()
        page = document.new_page(width=400, height=400)
        page.insert_text((50, 80), "NATIVE HEADER")
        page.draw_polyline([(70, 230), (90, 180), (110, 230), (100, 208), (80, 208)], width=3)
        reader = VectorOCR()
        result = parse(self.request(document.tobytes()), self.settings, self.versions, reader, lambda *_: None)
        self.assertEqual(reader.calls, 1)
        self.assertIn("VECTOR_REGIONS_REQUIRE_REVIEW", result["reasons"])
        self.assertIn("SYNTHETIC VECTOR", result["raw_text"])
        self.assertIn("NATIVE HEADER", result["raw_text"])
        self.assertEqual(result["pages"][0]["transform"]["ocr_regions"][0]["bbox"], [0, 0, 1, 1])

    def test_ruled_scan_geometry_retains_cells_and_merged_span(self):
        image = Image.new("RGB", (800, 500), "white")
        draw = ImageDraw.Draw(image)
        for y in (100, 200, 300, 400):
            draw.line((50, y, 750, y), fill="black", width=3)
        for x in (50, 750):
            draw.line((x, 100, x, 400), fill="black", width=3)
        draw.line((400, 200, 400, 400), fill="black", width=3)
        blocks = [block("SYNTHETIC HEADER", [.15, .27, .7, .33], "ocr"),
                  block("CELL", [.12, .47, .3, .53], "ocr")]
        structured, found = structure_tables(blocks, image, 1)
        self.assertTrue(found)
        self.assertEqual(len(structured), 5)
        merged = next(item for item in structured if "HEADER" in item["raw_text"])
        self.assertEqual(merged["column_span"], 2)
        self.assertTrue(all(item["kind"] == "table_cell" for item in structured))

    def test_non_table_keeps_ocr_order_after_coordinate_rotation(self):
        first = block("FIRST", [.6, .1, .8, .9], "ocr")
        second = block("SECOND", [.3, .1, .5, .9], "ocr")
        result, found = structure_tables([first, second], Image.new("RGB", (600, 400), "white"), 1)
        self.assertFalse(found)
        self.assertEqual([part["raw_text"] for part in result], ["FIRST", "SECOND"])

    def test_xml_attributes_mixed_content_and_external_entities(self):
        items, _ = xml_items(b'<a code="42">A<b>B<c>C</c>D</b>E</a>', self.settings)
        self.assertEqual([item["text"] for item in items], ["42", "A", "B", "C", "D", "E"])
        self.assertTrue(items[0]["path"].endswith("/@code"))
        with self.assertRaisesRegex(ParseError, "XML_DTD_FORBIDDEN"):
            xml_items(b'<!DOCTYPE a [<!ENTITY e SYSTEM "http://127.0.0.1/private">]><a>&e;</a>', self.settings)

    def test_docx_tables_headers_and_raw_tabs_are_retained(self):
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Текст</w:t><w:tab/><w:t>+ № 52</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Ячейка</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
        header = '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Колонтитул</w:t></w:r></w:p></w:hdr>'
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("word/document.xml", xml)
            archive.writestr("word/header1.xml", header)
        items, _ = docx_items(data.getvalue(), self.settings)
        self.assertEqual([item["text"] for item in items], ["Текст\t+ № 52", "Ячейка", "Колонтитул"])
        self.assertEqual(items[1]["row"], 0)
        artifact = parse(self.request(data.getvalue(), "docx"), self.settings, self.versions, NoOCR(), lambda *_: None)
        self.assertIn("Текст\t+ № 52", artifact["raw_text"])
        self.assertIn("Текст + № 52", artifact["normalized_text"])
        self.assertTrue(all(item["structural_path"] for page in artifact["pages"] for item in page["blocks"]))

    def test_docx_revisions_and_field_codes_are_separate_and_low_quality(self):
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Шифр </w:t></w:r><w:del><w:r><w:delText>A-100</w:delText></w:r></w:del><w:ins><w:r><w:t>A-200</w:t></w:r></w:ins><w:r><w:instrText>PAGE</w:instrText><w:t>1</w:t></w:r></w:p></w:body></w:document>'
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("word/document.xml", xml)
        result = parse(self.request(data.getvalue(), "docx"), self.settings, self.versions, NoOCR(), lambda *_: None)
        self.assertEqual(result["quality"], "LOW_QUALITY")
        self.assertIn("DOCX_TRACKED_CHANGES", result["reasons"])
        self.assertIn("DOCX_FIELD_INSTRUCTIONS", result["reasons"])
        self.assertNotIn("A-100A-200", result["raw_text"])
        self.assertEqual([item["raw_text"] for item in result["pages"][0]["blocks"]], ["Шифр ", "A-100", "A-200", "PAGE", "1"])

    def test_image_only_docx_uses_local_ocr_and_relationship_locator(self):
        image = Image.new("RGB", (300, 120), "white")
        ImageDraw.Draw(image).text((30, 30), "SYNTHETIC IMAGE TEXT", fill="black")
        png = io.BytesIO()
        image.save(png, "PNG")
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
            archive.writestr("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/test.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://127.0.0.1/private.png" TargetMode="External"/></Relationships>')
            archive.writestr("word/media/test.png", png.getvalue())
        reader = ImageOCR()
        result = parse(self.request(data.getvalue(), "docx"), self.settings, self.versions, reader, lambda *_: None)
        self.assertEqual(reader.calls, 1)
        self.assertEqual(len(result["pages"]), 1)
        self.assertEqual(result["quality"], "LOW_QUALITY")
        self.assertIn("SYNTHETIC IMAGE TEXT", result["raw_text"])
        self.assertIn("DOCX_EXTERNAL_MEDIA_UNAVAILABLE", result["reasons"])
        self.assertEqual(result["pages"][0]["blocks"][0]["structural_path"], "/word/media/test.png")
        self.assertIn("rId1", result["pages"][0]["transform"]["media_relationships"][0])

    def test_semantic_xml_repeats_pixels_and_preserves_long_source_text(self):
        text = "Исходный\t текст № 5/РД+\n" * 180
        data = ("<root><value>" + text + "</value></root>").encode()
        request = self.request(data, "xml")
        first = parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        second = parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        self.assertGreater(len(first["pages"]), 1)
        self.assertEqual(first["raw_text"], text)
        self.assertEqual(first["quality"], "OK")
        self.assertEqual([p["image_sha256"] for p in first["pages"]], [p["image_sha256"] for p in second["pages"]])
        self.assertEqual("".join(b["raw_text"] for p in first["pages"] for b in p["blocks"]), text)
        self.assertNotEqual(first["pages"][0]["image_key"], second["pages"][0]["image_key"])

    def test_page_limit_and_docx_expansion_are_permanent(self):
        document = pymupdf.open()
        document.new_page()
        document.new_page()
        with self.assertRaisesRegex(ParseError, "PAGE_LIMIT"):
            parse(self.request(document.tobytes()), replace(self.settings, max_pages=1), self.versions, NoOCR(), lambda *_: None)
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("word/document.xml", "x" * 10000)
        with self.assertRaisesRegex(ParseError, "DOCX_EXPANSION_LIMIT"):
            docx_items(data.getvalue(), replace(self.settings, max_xml_bytes=500))

    def test_pdf_checkpoint_reuses_only_matching_source_and_pipeline(self):
        document = pymupdf.open()
        document.new_page().insert_text((50, 100), "SYNTHETIC CHECKPOINT")
        request = self.request(document.tobytes())
        first = parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        second = parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        third = parse(request, self.settings, {**self.versions, "parser": "changed"}, NoOCR(), lambda *_: None)
        self.assertEqual(first["pages"][0]["image_key"], second["pages"][0]["image_key"])
        self.assertNotEqual(first["pages"][0]["image_key"], third["pages"][0]["image_key"])

    def test_corrupt_checkpoint_metadata_is_recomputed(self):
        document = pymupdf.open()
        document.new_page().insert_text((50, 100), "SYNTHETIC CHECKPOINT")
        request = self.request(document.tobytes())
        first = parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        path = next((self.settings.storage / "derived" / ".parser-checkpoints").rglob("1.json"))
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
        checkpoint["page"]["blocks"][0]["bbox"] = [0, 0, 0, 0]
        path.write_text(json.dumps(checkpoint), encoding="utf-8")
        second = parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        self.assertNotEqual(first["pages"][0]["image_key"], second["pages"][0]["image_key"])

    def test_orientation_classifier_bounds_full_ocr_passes_and_maps_back(self):
        for scores, expected_passes in (([.9, .05, .03, .02], 1), ([.45, .4, .1, .05], 2)):
            reader = LocalOCR.__new__(LocalOCR)
            reader.orientation = OrientationStub(scores)
            reader.engine = OCRStub()
            blocks, angle, count = reader.recognize(Image.new("RGB", (100, 200), "white"))
            self.assertEqual(reader.engine.calls, expected_passes)
            self.assertEqual(angle, 270)
            self.assertEqual(count, 1)
            self.assertEqual(blocks[0]["bbox"], [.1, .7, .3, .8])
            self.assertEqual(reader.orientation_ambiguous, expected_passes == 2)

    def test_hash_and_handles_are_checked(self):
        request = self.request(b"<root/>", "xml")
        request["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(ParseError, "SOURCE_HASH_MISMATCH"):
            parse(request, self.settings, self.versions, NoOCR(), lambda *_: None)
        request["storage_key"] = "../escape"
        with self.assertRaisesRegex(ParseError, "INVALID_REQUEST"):
            validate_request(request)

    def test_orientation_inverse(self):
        self.assertEqual(unrotate_point(20, 70, 1, 100, 200), (30, 20))
        self.assertEqual(unrotate_point(70, 180, 2, 100, 200), (30, 20))
        self.assertEqual(unrotate_point(180, 30, 3, 100, 200), (30, 20))

    def test_timeout_kills_busy_cpu_child_and_restarts(self):
        supervisor = Supervisor(self.settings, self.versions, busy_worker)
        try:
            for _ in range(100):
                try:
                    supervisor.health()
                    break
                except ParseError:
                    time.sleep(.05)
            old_process = supervisor.process
            with self.assertRaisesRegex(ParseError, "PARSER_TIMEOUT"):
                supervisor.run({"request_id": str(uuid.uuid4())})
            self.assertFalse(old_process.is_alive())
            self.assertNotEqual(old_process.pid, supervisor.process.pid)
        finally:
            supervisor.stop()

    def test_cancel_kills_cpu_child(self):
        supervisor = Supervisor(self.settings, self.versions, busy_worker)
        errors = []
        try:
            for _ in range(100):
                try:
                    supervisor.health()
                    break
                except ParseError:
                    time.sleep(.05)
            request_id = str(uuid.uuid4())
            old_process = supervisor.process

            def run():
                try:
                    supervisor.run({"request_id": request_id})
                except ParseError as error:
                    errors.append(error.code)
            thread = threading.Thread(target=run)
            thread.start()
            for _ in range(100):
                if supervisor.active:
                    break
                time.sleep(.01)
            self.assertTrue(supervisor.cancel(request_id)["cancelled"])
            self.assertFalse(old_process.is_alive())
            thread.join(5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(errors, ["PARSER_CANCELLED"])
        finally:
            supervisor.stop()


if __name__ == "__main__":
    unittest.main()
