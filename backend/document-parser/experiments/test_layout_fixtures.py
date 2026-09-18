"""Validate source fixtures and annotation geometry, without layout/OCR inference.

These checks are not acceptance tests of adaptive routing or native table
extraction: that production implementation does not exist in this experiment.
"""
import hashlib
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
import pymupdf as fitz

from layout_fixtures import generate


class LayoutFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.cases = {case["id"]: case for case in generate(cls.root)}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_saved_inputs_and_hashes_cover_all_seven_expected_cases(self):
        self.assertEqual(set(self.cases), {"native-table", "mixed", "broken-encoding", "crop-0", "crop-90", "crop-180", "crop-270"})
        for name, case in self.cases.items():
            with self.subTest(name=name):
                self.assertEqual(case["source_sha256"], hashlib.sha256((self.root / f"{name}.pdf").read_bytes()).hexdigest())
                self.assertEqual(case["image_sha256"], hashlib.sha256(Path(case["image_path"]).read_bytes()).hexdigest())
                self.assertEqual((case["page_number"], case["split"]), (1, "development"))
                for region in case["expected_regions"]:
                    a, b, c, d = region["bbox"]
                    self.assertTrue(0 <= a < c <= 1 and 0 <= b < d <= 1)

    def test_crop_rotation_annotations_match_ink_and_preserve_source_cropbox(self):
        # Independent values derived from original table [60,120,580,300],
        # CropBox [30,40,610,760] and visible page sizes 580x720 / 720x580.
        expected = {
            0: [30/580, 80/720, 550/580, 260/720],
            90: [460/720, 30/580, 640/720, 550/580],
            180: [30/580, 460/720, 550/580, 640/720],
            270: [80/720, 30/580, 260/720, 550/580],
        }
        measured = []
        for rotation, coordinates in expected.items():
            with self.subTest(rotation=rotation):
                case = self.cases[f"crop-{rotation}"]
                bbox = next(r["bbox"] for r in case["expected_regions"] if r["kind"] == "table")
                for actual, target in zip(bbox, coordinates):
                    self.assertAlmostEqual(actual, target, places=8)
                path = self.root / f"crop-{rotation}.pdf"
                with fitz.open(path) as doc:
                    page = doc[0]
                    self.assertEqual(list(page.cropbox), [30, 40, 610, 760])
                    self.assertEqual(list(page.mediabox), [0, 0, 640, 800])
                    self.assertEqual(page.rotation, rotation)
                    raster = page.get_pixmap(matrix=fitz.Matrix(200/72, 200/72), alpha=False)
                    with Image.open(case["image_path"]) as image:
                        self.assertEqual(image.size, (raster.width, raster.height))
                        self.assertEqual(image.convert("RGB").tobytes(), raster.samples)
                        # Tight table-frame IoU rejects an annotation that merely
                        # contains some ink while covering most of the page.
                        box = np.array(bbox) * [image.width, image.height, image.width, image.height]
                        left, top = max(0, int(box[0])-4), max(0, int(box[1])-4)
                        right, bottom = min(image.width, int(box[2])+5), min(image.height, int(box[3])+5)
                        gray = np.array(image.crop((left, top, right, bottom)).convert("L"))
                        yy, xx = np.where(gray < 100)
                        ink = np.array([left+xx.min(), top+yy.min(), left+xx.max()+1, top+yy.max()+1])
                        intersection = max(0, min(ink[2], box[2])-max(ink[0], box[0])) * max(0, min(ink[3], box[3])-max(ink[1], box[1]))
                        union = (ink[2]-ink[0])*(ink[3]-ink[1]) + (box[2]-box[0])*(box[3]-box[1])-intersection
                        iou = intersection / union
                        measured.append(float(iou))
                        self.assertGreater(iou, .98)
                    self.assertEqual(list(page.cropbox), [30, 40, 610, 760])
                self.assertEqual(case["source_sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        print(f"layout_fixture_table_frame_min_iou={min(measured):.6f}", flush=True)

    def test_native_table_is_real_vector_grid_with_extractable_cell_text(self):
        with fitz.open(self.root / "native-table.pdf") as doc:
            page = doc[0]
            self.assertEqual(page.get_image_info(), [])
            text = page.get_text(flags=0)
            for value in ("Parameter", "Value", "Unit", *(f"R{row} C{col}" for row in range(1, 4) for col in range(3))):
                self.assertIn(value, text)
            paths = page.get_drawings()
            self.assertEqual(len(paths), 9)
            self.assertTrue(all(len(path["items"]) == 1 and path["items"][0][0] == "l" for path in paths))
            extents = [path["rect"] for path in paths]
            self.assertEqual([min(r.x0 for r in extents), min(r.y0 for r in extents), max(r.x1 for r in extents), max(r.y1 for r in extents)], [60, 120, 580, 300])

    def test_mixed_case_keeps_raster_note_separate_from_native_drawing_labels(self):
        with fitz.open(self.root / "mixed.pdf") as doc:
            page = doc[0]
            text = page.get_text(flags=0)
            self.assertIn("Parameter", text)
            self.assertIn("A1", text)
            self.assertIn("93.0", text)
            self.assertIn("Figure 1. Synthetic diagram", text)
            self.assertNotIn("Raster note", text)
            self.assertNotIn("Keep this explanation", text)
            images = page.get_image_info()
            self.assertEqual(len(images), 1)
            self.assertEqual(list(images[0]["bbox"]), [60, 340, 580, 410])
            self.assertEqual((images[0]["width"], images[0]["height"]), (1040, 140))
            self.assertIn("graphic", [r["kind"] for r in self.cases["mixed"]["expected_regions"]])

    def test_broken_tounicode_exposes_replacement_with_flags_zero_but_pixels_unchanged(self):
        with fitz.open(self.root / "broken-encoding.pdf") as doc:
            page = doc[0]
            self.assertIn("\ufffd" * 4, page.get_text(flags=0))
            self.assertIn("AAAA", page.get_text())  # Default CID repair conceals the corrupt mapping.
            self.assertEqual(page.get_image_info(), [])
            font = page.get_fonts()[0][0]
            kind, reference = doc.xref_get_key(font, "ToUnicode")
            self.assertEqual(kind, "xref")
            self.assertIn(b"<41> <FFFD>", doc.xref_stream(int(reference.split()[0])))
            with fitz.open() as clean:
                control = clean.new_page(width=640, height=800)
                control.insert_text((60, 75), "Synthetic layout control", fontsize=17)
                control.insert_text((60, 140), "AAAA valid visible text but broken extraction", fontsize=14)
                matrix = fitz.Matrix(200/72, 200/72)
                self.assertEqual(page.get_pixmap(matrix=matrix, alpha=False).samples,
                                 control.get_pixmap(matrix=matrix, alpha=False).samples)


if __name__ == "__main__":
    unittest.main()
