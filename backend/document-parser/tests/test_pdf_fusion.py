"""Deterministic evidence selection tests; these do not measure OCR accuracy."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import block, finalize_page
from pdf_fusion import annotate, eligible, reconcile_readings, reconcile_table


def reading(text, box, source="native", valid=True):
    result = block(text, box, source)
    result["include_in_main"] = True
    if source == "native":
        result["native_valid"] = valid
    return result


def cell(text, box, row=0, column=0, source="ocr", **spans):
    return {**block(text, box, source, table_id="t1", row=row, column=column,
                   row_span=spans.get("row_span", 1), column_span=spans.get("column_span", 1)),
            "include_in_main": True}


class ReadingFusionTests(unittest.TestCase):
    def test_native_wins_without_rewriting_units_signs_or_raw_alternative(self):
        for raw, wrong in [("м²", "$m{f}$"), ("м³", "$M{f}$"), ("пог. м", "пог.M"), ("−12,5", "12.5"), ("Ø16", "016")]:
            native = reading(raw, [.2,.2,.4,.3])
            ocr = reading(wrong, [.19,.19,.41,.31], "ocr")
            reconcile_readings([native], [ocr])
            self.assertTrue(eligible(native), raw)
            self.assertFalse(eligible(ocr), raw)
            self.assertEqual(native["raw_text"], raw)
            self.assertEqual(ocr["raw_text"], wrong)
            self.assertEqual(native["provenance"]["method"], "hybrid")
            self.assertEqual(ocr["provenance"]["status"], "ambiguous")
            self.assertEqual(native["provenance"]["fragments"][1]["raw_text"], wrong)

    def test_partial_overlapping_line_is_not_sliced_or_concatenated(self):
        native = reading("A −1", [.1,.2,.4,.3])
        ocr = reading("A -1 RASTER", [.1,.2,.9,.3], "ocr")
        complement = reading("RASTER BELOW", [.1,.5,.8,.6], "ocr")
        reconcile_readings([native], [ocr, complement])
        self.assertEqual([item["raw_text"] for item in [native, ocr, complement] if eligible(item)], ["A −1", "RASTER BELOW"])
        self.assertEqual(ocr["raw_text"], "A -1 RASTER")
        self.assertIn("NATIVE_OCR_TEXT_CONFLICT", ocr["provenance"]["reasons"])

    def test_invalid_native_cannot_suppress_recognition(self):
        native = reading("\ufffd", [.1,.2,.4,.3], valid=False)
        ocr = reading("50 м³", [.1,.2,.4,.3], "ocr")
        reconcile_readings([native], [ocr])
        self.assertFalse(eligible(native))
        self.assertTrue(eligible(ocr))
        self.assertFalse(native["provenance"]["fragments"][0]["native_valid"])

    def test_duplicate_ocr_crop_has_one_selected_value(self):
        native = reading("м²", [.2,.2,.4,.3])
        duplicates = [reading("м²", [.2,.2,.4,.3], "ocr") for _ in range(2)]
        reconcile_readings([native], duplicates)
        self.assertEqual(sum(eligible(item) for item in [native] + duplicates), 1)
        self.assertTrue(all(item["raw_text"] == "м²" for item in duplicates))
        duplicates = [reading("50", [.2,.2,.4,.3], "ocr") for _ in range(2)]
        reconcile_readings([], duplicates)
        self.assertEqual(sum(eligible(item) for item in duplicates), 1)

    def test_conflicting_native_or_ocr_readings_abstain(self):
        for source in ("native", "ocr"):
            candidates = [reading(text, [.2,.2,.4,.3], source) for text in ("−50", "50")]
            reconcile_readings(candidates if source == "native" else [], candidates if source == "ocr" else [])
            self.assertFalse(any(eligible(item) for item in candidates))
            self.assertTrue(all(item["provenance"]["status"] == "ambiguous" for item in candidates))

    def test_native_conflict_cannot_be_silently_resolved_by_ocr(self):
        native = [reading(text, [.2,.2,.4,.3]) for text in ("−50", "50")]
        ocr = reading("50", [.19,.19,.41,.31], "ocr")
        reconcile_readings(native, [ocr])
        self.assertFalse(any(eligible(item) for item in native + [ocr]))
        self.assertEqual(ocr["provenance"]["status"], "ambiguous")
        self.assertEqual(ocr["provenance"]["reasons"], ["NATIVE_CONFLICT_UNRESOLVED"])
        self.assertEqual({part["raw_text"] for part in ocr["provenance"]["fragments"]}, {"−50", "50"})

    def test_hidden_native_duplicate_has_an_explicit_suppression_reason(self):
        native = [reading("DRAWING 93.0", [.2,.2,.4,.3]) for _ in range(3)]
        for item in native:
            item["include_in_main"] = False
        reconcile_readings(native, [], include_hidden_native=True)
        self.assertTrue(all(item["native_valid"] for item in native))
        self.assertTrue(all(item["include_in_main"] is False for item in native))
        self.assertEqual(native[0]["provenance"]["reasons"], ["NATIVE_DUPLICATE_ALTERNATIVE_RETAINED"])
        self.assertTrue(all(item["provenance"]["reasons"] == ["DUPLICATE_NATIVE_READING"] for item in native[1:]))


class TableFusionTests(unittest.TestCase):
    def test_cell_model_concatenation_is_only_an_alternative(self):
        native = reading("м²", [.62,.22,.7,.28])
        ocr = reading("$m{f}$", [.61,.21,.72,.29], "ocr")
        cells = [cell("м² $m{f}$", [.6,.2,.8,.3])]
        reconcile_readings([native], [ocr])
        reconcile_table(cells, [native], [ocr])
        self.assertEqual(cells[0]["raw_text"], "м²")
        self.assertEqual(cells[0]["source"], "native")
        self.assertTrue(cells[0]["native_valid"])
        self.assertFalse(eligible(native))
        alternatives = {item["raw_text"] for item in cells[0]["provenance"]["fragments"] if item["role"] == "alternative"}
        self.assertEqual(alternatives, {"$m{f}$", "м² $m{f}$"})
        self.assertEqual(sum(eligible(item) for item in [native, ocr] + cells), 1)

    def test_model_only_text_cannot_certify_itself_but_empty_cell_remains(self):
        cells = [cell("Invented model cell", [.1,.2,.3,.3]), cell("", [.3,.2,.5,.3], column=1)]
        reconcile_table(cells, [], [])
        self.assertFalse(eligible(cells[0]))
        self.assertEqual(cells[0]["provenance"]["status"], "ambiguous")
        self.assertEqual(cells[0]["provenance"]["reasons"], ["TABLE_TEXT_WITHOUT_LOCATED_SUPPORT"])
        self.assertEqual(cells[0]["raw_text"], "Invented model cell")
        self.assertTrue(eligible(cells[1]))
        self.assertEqual(cells[1]["raw_text"], "")

    def test_cross_column_whole_line_links_quantity_without_guessing_split(self):
        line = reading("ТУ 5767 ЭППС 35 Пеноплекс ГЕО", [.12,.22,.58,.28])
        cells = [cell("", [.1,.2,.3,.3], column=0), cell("", [.3,.2,.6,.3], column=1),
                 cell("50", [.6,.2,.7,.3], column=2), cell("м³", [.7,.2,.8,.3], column=3)]
        reconcile_table(cells, [line], [])
        self.assertEqual(line["table_link"]["status"], "associated")
        self.assertEqual(line["table_link"]["rows"], [0])
        self.assertEqual(line["table_link"]["columns"], [0, 1])
        self.assertTrue(eligible(line))
        self.assertEqual([item["raw_text"] for item in cells], ["", "", "50", "м³"])
        page = finalize_page({"page_number":1, "blocks":[line] + cells, "reasons":[]})
        self.assertEqual(page["blocks"][0]["table_link"]["table_id"], page["blocks"][1]["table_id"])

    def test_crossing_reading_cannot_assert_model_cell_value(self):
        line = reading("DESIGNATION NAME", [.12,.22,.58,.28])
        cells = [cell("DESIGNATION NAME", [.1,.2,.3,.3]), cell("", [.3,.2,.6,.3], column=1)]
        reconcile_table(cells, [line], [])
        self.assertFalse(eligible(cells[0]))
        self.assertEqual(cells[0]["provenance"]["status"], "ambiguous")
        self.assertEqual(cells[0]["raw_text"], "DESIGNATION NAME")

    def test_cross_row_or_two_tables_is_explicitly_ambiguous(self):
        line = reading("MATERIAL 50", [.15,.28,.55,.32])
        cells = [cell("", [.1,.2,.6,.3]), cell("", [.1,.3,.6,.4], row=1)]
        reconcile_table(cells, [line], [])
        self.assertEqual(line["table_link"]["status"], "ambiguous")
        self.assertEqual(line["table_link"]["rows"], [0, 1])
        self.assertTrue(eligible(line))
        cells[1]["table_id"] = "t2"
        reconcile_table(cells, [line], [])
        self.assertIsNone(line["table_link"]["table_id"])

    def test_merged_cell_retains_span_and_empty_geometry(self):
        line = reading("A −1", [.12,.22,.4,.28])
        cells = [cell("", [.1,.2,.5,.4], source="native", row_span=2, column_span=2),
                 cell("", [.5,.2,.6,.4], source="native", column=2, row_span=2)]
        reconcile_table(cells, [line], [])
        self.assertEqual((cells[0]["row_span"], cells[0]["column_span"]), (2, 2))
        self.assertEqual(cells[0]["raw_text"], "A −1")
        self.assertEqual(cells[1]["raw_text"], "")
        self.assertNotIn("table_link", line)
        self.assertTrue(cells[1]["native_valid"])

    def test_located_native_and_disjoint_ocr_fill_same_cell_once(self):
        native = reading("Native first", [.2,.21,.4,.24])
        ocr = reading("Raster second −5", [.2,.26,.4,.29], "ocr")
        cells = [cell("Native first Raster second −5", [.1,.2,.5,.3])]
        reconcile_readings([native], [ocr])
        reconcile_table(cells, [native], [ocr])
        self.assertEqual(cells[0]["raw_text"], "Native first\nRaster second −5")
        self.assertEqual(cells[0]["provenance"]["method"], "hybrid")
        self.assertFalse(eligible(native)); self.assertFalse(eligible(ocr))


class HistoricalRegressionTests(unittest.TestCase):
    """Replay measured candidate geometry, not a fresh OCR-model evaluation."""
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads((Path(__file__).parent / "fixtures/native-ocr/material-cases.json").read_text(encoding="utf-8"))

    def test_five_measured_unit_conflicts_choose_exact_native(self):
        for case in self.fixture["unit_cases"]:
            with self.subTest(case=case["case_id"]):
                cells = [deepcopy(case["cell"])]
                native = [deepcopy(item) for item in case["input_candidates"] if item["source"] == "native"]
                ocr = [deepcopy(item) for item in case["input_candidates"] if item["source"] == "ocr" and item["confidence"] is not None]
                for item in native:
                    item.update(native_valid=True, include_in_main=True)
                original = cells[0]["raw_text"]
                reconcile_readings(native, ocr)
                reconcile_table(cells, native, ocr)
                self.assertEqual(cells[0]["raw_text"], native[0]["raw_text"])
                self.assertNotEqual(cells[0]["raw_text"], original)
                self.assertIn(original, [part["raw_text"] for part in cells[0]["provenance"]["fragments"]])

    def test_measured_cross_column_line_links_to_50_m3_and_not_adjacent_row(self):
        case = self.fixture["cross_column_case"]
        cells = deepcopy(case["table_cells"])
        native = [deepcopy(item) for item in case["input_candidates"] if item["source"] == "native"]
        ocr = [deepcopy(item) for item in case["input_candidates"] if item["source"] == "ocr" and item["confidence"] is not None]
        for item in native:
            item.update(native_valid=True, include_in_main=True)
        reconcile_readings(native, ocr)
        reconcile_table(cells, native, ocr)
        crossing = next(item for item in native if item["id"] == case["crossing_native_block_id"])
        self.assertTrue(eligible(crossing))
        self.assertEqual(crossing["table_link"]["status"], "associated")
        self.assertEqual(crossing["table_link"]["rows"], [case["expected"]["row"]])
        self.assertEqual(crossing["table_link"]["columns"], [1, 2])
        row = [item for item in cells if item["row"] == case["expected"]["row"]]
        self.assertEqual(next(item for item in row if item["column"] == 3)["raw_text"], "50")
        self.assertEqual(next(item for item in row if item["column"] == 4)["raw_text"], "м³")
        self.assertTrue(all(not item["raw_text"] for item in row if item["column"] in (1, 2)))
        self.assertIn(case["expected"]["designation"], crossing["raw_text"])
        self.assertIn(case["expected"]["name"], crossing["raw_text"])


if __name__ == "__main__":
    unittest.main()
