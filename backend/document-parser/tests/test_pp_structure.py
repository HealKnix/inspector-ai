"""Synthetic PAR table/orientation/content tests. No customer documents or OCR."""
import copy
from dataclasses import replace
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import block, finalize_page
from config import OCR_OPTIONS, Settings, fingerprint
from pp_structure import convert_result, table_cells


def fixture(angle=0):
    width, height = 400, 300
    turn = angle // 90
    def point(x, y):
        return ((x, y), (y, width - x), (width - x, height - y), (height - y, x))[turn]
    boxes = [[80, 70, 160, 110], [160, 70, 240, 110], [80, 110, 160, 150], [160, 110, 240, 150]]
    mapped = []
    for a, b, c, d in boxes:
        xs, ys = zip(*(point(x, y) for x, y in ((a, b), (c, b), (c, d), (a, d))))
        mapped.append([min(xs), min(ys), max(xs), max(ys)])
    return {"width": height if turn % 2 else width, "height": width if turn % 2 else height,
        "doc_preprocessor_res": {"angle": angle},
        "overall_ocr_res": {"rec_texts": ["Температура\t 40", "RAW\nSIGN+№"], "rec_scores": [.99, .9],
            "rec_polys": [[point(90, 80), point(140, 80), point(140, 95), point(90, 95)],
                          [point(10, 200), point(90, 200), point(90, 220), point(10, 220)]], "dt_polys": [[1], [2], [3]]},
        "table_res_list": [{"cell_box_list": mapped,
            "pred_html": '<table><tr><td>Температура</td><td>-40</td></tr><tr><td>Размер</td><td>12 (120)</td></tr></table>',
            "table_ocr_pred": {"rec_texts": ["Температура", "-40", "Размер", "12 (120)"]}}]}, boxes


class StructureTests(unittest.TestCase):
    def test_whitespace_ocr_text_is_omitted_but_empty_table_cells_survive(self):
        data, _ = fixture()
        data["overall_ocr_res"]["rec_texts"] = [" \t\n", "RAW\nSIGN+№"]
        data["table_res_list"][0]["pred_html"] = '<table><tr><td> </td><td></td></tr><tr><td>\n</td><td>42</td></tr></table>'
        data["table_res_list"][0]["table_ocr_pred"]["rec_texts"] = [" ", "\n", ""]
        blocks, *_ = convert_result(data, 400, 300)
        self.assertEqual(sum(b["kind"] == "table_cell" for b in blocks), 4)
        self.assertEqual(sum(b["kind"] == "table_cell" and not b["normalized_text"] for b in blocks), 3)
        self.assertTrue(all(b["normalized_text"] for b in blocks if b["kind"] == "text"))
        self.assertEqual(blocks[0]["structural_path"], "ocr/overall/line[2]")
        data["table_res_list"][0]["pred_html"] = '<table><tr><td> </td><td> </td></tr></table>'
        data["table_res_list"][0]["cell_box_list"] = []
        blocks, _, _, reasons = convert_result(data, 400, 300)
        self.assertEqual(len(blocks), 1)
        self.assertIn("TABLE_STRUCTURE_REJECTED", reasons)

    def test_all_four_rotations_restore_cell_and_line_boxes(self):
        for angle in (0, 90, 180, 270):
            with self.subTest(angle=angle):
                data, expected = fixture(angle)
                blocks, returned_angle, detected, reasons = convert_result(data, 400, 300)
                cells = [b for b in blocks if b["kind"] == "table_cell"]
                self.assertEqual(len(cells), 4)
                self.assertEqual((returned_angle, detected), (angle, 3))
                for cell, box in zip(cells, expected):
                    for actual, value in zip(cell["bbox"], [box[0] / 400, box[1] / 300, box[2] / 400, box[3] / 300]):
                        self.assertAlmostEqual(actual, value, places=6)
                self.assertEqual(blocks[0]["bbox"], [.225, .2666667, .35, .3166667])
                self.assertIn("TABLE_STRUCTURE_UNVERIFIED", reasons)

    def test_preserves_overall_text_and_disputed_table_reading(self):
        data, _ = fixture()
        blocks, _, _, reasons = convert_result(data, 400, 300)
        overall = [b["raw_text"] for b in blocks if "/overall/" in b["structural_path"]]
        self.assertEqual(overall, data["overall_ocr_res"]["rec_texts"])
        self.assertIn("-40", [b["raw_text"] for b in blocks])
        alternative = next(b for b in blocks if b["structural_path"].endswith("/recognition-text"))
        self.assertEqual(alternative["raw_text"], "Температура\n-40\nРазмер\n12 (120)")
        self.assertIn("OCR_TABLE_TEXT_DIFFERENCE", reasons)
        self.assertTrue(all("<table>" not in b["raw_text"] for b in blocks))

    def test_merged_cells_keep_empty_cells_and_reject_grid_overlap(self):
        cells, valid = table_cells('<table><tr><td colspan="2">A</td></tr><tr><td></td><td>B</td></tr></table>')
        self.assertTrue(valid)
        self.assertEqual([(c["row"], c["column"], c["column_span"]) for c in cells], [(0, 0, 2), (1, 0, 1), (1, 1, 1)])
        self.assertEqual(cells[1]["text"], "")
        _, valid = table_cells('<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr></table>')
        self.assertFalse(valid)

    def test_rejected_grid_keeps_text_from_invalid_cells_without_html(self):
        for attribute in ('rowspan="0"', 'colspan="1001"', 'rowspan="bad"', 'rowspan="1000" colspan="1000"'):
            with self.subTest(attribute=attribute):
                data, _ = fixture()
                data["overall_ocr_res"]["rec_texts"] = []
                data["table_res_list"][0] = {"cell_box_list": [], "table_ocr_pred": {"rec_texts": []},
                    "pred_html": f'<table><tr><td {attribute}>UNIQUE <b>−40</b> &amp; ХВС</td><td>SECOND</td></tr></table>'}
                blocks, _, _, reasons = convert_result(data, 400, 300)
                self.assertEqual(len(blocks), 1)
                self.assertEqual(blocks[0]["kind"], "text")
                self.assertEqual(blocks[0]["normalized_text"], "UNIQUE −40 & ХВС\nSECOND")
                self.assertTrue(blocks[0]["structural_path"].endswith("/unstructured"))
                self.assertIn("TABLE_STRUCTURE_REJECTED", reasons)
                self.assertNotIn("<", blocks[0]["raw_text"])

    def test_malformed_geometry_downgrades_without_losing_text(self):
        for variant in ("overlap", "wrong_count", "crossed_axis", "inverted", "invalid_html"):
            data, _ = fixture()
            table = data["table_res_list"][0]
            if variant == "overlap":
                table["cell_box_list"][1] = table["cell_box_list"][0]
            elif variant == "wrong_count":
                table["cell_box_list"].pop()
            elif variant == "crossed_axis":
                table["cell_box_list"][0], table["cell_box_list"][1] = table["cell_box_list"][1], table["cell_box_list"][0]
            elif variant == "inverted":
                table["cell_box_list"][0] = [80, 70, 40, 110]
            else:
                table["pred_html"] = '<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr></table>'
            blocks, _, _, reasons = convert_result(data, 400, 300)
            self.assertFalse(any(b["kind"] == "table_cell" for b in blocks), variant)
            self.assertIn("TABLE_STRUCTURE_REJECTED", reasons)
            self.assertEqual(blocks[0]["raw_text"], "Температура\t 40")
            self.assertTrue(any(b["structural_path"].endswith("/recognition-text") for b in blocks))

    def test_legitimate_full_page_table_is_not_rejected_by_area(self):
        data, _ = fixture()
        data["table_res_list"][0]["cell_box_list"] = [[0, 0, 200, 150], [200, 0, 400, 150], [0, 150, 200, 300], [200, 150, 400, 300]]
        blocks, _, _, reasons = convert_result(data, 400, 300)
        self.assertEqual(sum(b["kind"] == "table_cell" for b in blocks), 4)
        self.assertNotIn("TABLE_STRUCTURE_REJECTED", reasons)

    def test_fragment_ids_are_disjoint_and_page_scoped(self):
        cells = [block(text, [0, .1, .5, .2], "structured", f"source/p[{i}]", table_id="source-table",
                       row=0, column=0, row_span=1, column_span=1) for i, text in enumerate(("FIRST", "SECOND"))]
        page = finalize_page({"page_number": 1, "blocks": cells, "reasons": []})
        self.assertNotEqual(page["blocks"][0]["table_id"], page["blocks"][1]["table_id"])
        self.assertEqual([b["raw_text"] for b in cells], ["FIRST", "SECOND"])
        self.assertTrue(all(b["structural_path"].startswith("source/") for b in cells))
        next_page = finalize_page({"page_number": 2, "blocks": copy.deepcopy(cells), "reasons": []})
        self.assertFalse({b["table_id"] for b in cells} & {b["table_id"] for b in next_page["blocks"]})

    def test_model_configuration_changes_fingerprint_and_versions_fit_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            font = root / "font"
            font.write_bytes(b"synthetic font")
            settings = Settings(root, root, font)
            with patch("config.verify_models", return_value={"synthetic-model": hashlib.sha256(b"model").hexdigest()}):
                first = settings.versions()
                with patch.dict(OCR_OPTIONS, text_det_limit_side_len=1024):
                    second = settings.versions()
                self.assertNotEqual(first["ocr_config"], second["ocr_config"])
                self.assertNotEqual(fingerprint(first), fingerprint(second))
                from config import REGION_OPTIONS
                with patch.dict(REGION_OPTIONS, native_line_coverage=.95):
                    regional = settings.versions()
                self.assertNotEqual(first["pdf_region_config"], regional["pdf_region_config"])
                self.assertNotEqual(fingerprint(first), fingerprint(regional))
                self.assertEqual(first["pdf_region_profile"], "paddle-regions-v1")
                self.assertTrue(all(isinstance(v, str) and len(v) <= 256 for v in first.values()))
                maximum = replace(settings, timeout=3600, max_pages=10000, max_pixels=80000000,
                    max_bytes=1073741824, max_xml_bytes=104857600, max_blocks=1000000, cpu_threads=16,
                    render_dpi=400, max_output_bytes=268435456).versions()
                self.assertTrue(all(len(v) <= 256 for v in maximum.values()))
                self.assertEqual(first["ocr_engine"], "PP-StructureV3")


if __name__ == "__main__":
    unittest.main()
