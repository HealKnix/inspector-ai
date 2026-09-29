"""Reproduce minimal, deidentified excerpts from the authorised local audit.

This reads no organiser gold and no hidden files. The original PDFs remain local.
Expected values are visually transcribed; historical OCR is diagnostic input only.
"""

import copy
import hashlib
import json
from pathlib import Path

import pypdfium2 as pdfium


REPO = Path(__file__).resolve().parents[2]
MATERIALS = REPO.parent
OUT = REPO / "backend/document-parser/tests/fixtures/native-ocr"
AUDIT = MATERIALS / "tmp/ocr-audit-20260926"
SOURCE_MANIFEST = REPO / ".test-output/real-documents-20260926/manifest.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(name, value):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"path": name, "sha256": digest(path), "bytes": path.stat().st_size}


def overlap(a, b):
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def is_raw_candidate(block):
    # Historical source=ocr also labels derived table aggregates. These are not
    # independent OCR observations and must not be fed back into fusion.
    return block["kind"] == "text" and (block["source"] == "native" or block.get("confidence") is not None)


def render_clip(pdf_path, bbox, name, scale=5, page_number=1):
    document = pdfium.PdfDocument(pdf_path)
    page = document[page_number - 1]
    width, height = page.get_size()
    x0, y0, x1, y1 = bbox
    crop = (x0 * width, (1 - y1) * height, (1 - x1) * width, y0 * height)
    bitmap = page.render(scale=scale, crop=crop)
    image = bitmap.to_pil()
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    record = {
        "path": name,
        "sha256": digest(path),
        "bytes": path.stat().st_size,
        "source_page": page_number,
        "source_bbox": bbox,
        "coordinate_space": "visible-page-normalized",
        "render_scale": scale,
        "image_width": image.width,
        "image_height": image.height,
        "operation": "PDFium render of original PDF clip; no OCR/retouching",
    }
    page.close()
    document.close()
    return record


def provenance(source, artifact_path):
    pdf_path = Path(source["path"])
    assert digest(pdf_path) == source["sha256"]
    return {
        "source_id": "authorised-diagnostic-" + source["sha256"][:12],
        "source_sha256": source["sha256"],
        "source_bytes": pdf_path.stat().st_size,
        "artifact_sha256": digest(artifact_path),
        "artifact_pipeline_fingerprint": read(artifact_path)["pipeline_fingerprint"],
        "source_lookup": ".test-output/real-documents-20260926/manifest.json (local only)",
        "source_lookup_sha256": digest(SOURCE_MANIFEST),
        "role": "authorised-diagnostic-regression",
        "organiser_split": None,
        "use": "known development regression; not independent validation or hidden accuracy",
        "authorisation": "User-requested repair of the existing 2026-09-26 diagnostic cases",
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = read(SOURCE_MANIFEST)["files"]
    base_source = next(s for s in sources if s["sha256"].startswith("04dcef6b"))
    rev_source = next(s for s in sources if s["sha256"].startswith("b8b03fee"))
    base = read(AUDIT / "gi-base.json")
    revision = read(AUDIT / "gi-rev3.json")
    page = base["pages"][0]
    blocks = page["blocks"]
    by_id = {b["id"]: b for b in blocks}
    crops = []
    cases = []
    for block_id, text, quantity in [
        ("p1-b467", "пог. м", "114"),
        ("p1-b479", "м³", "132"),
        ("p1-b485", "м²", "6600"),
        ("p1-b497", "м²", "3300"),
        ("p1-b521", "пог. м", "**"),
    ]:
        cell = by_id[block_id]
        bbox = cell["bbox"]
        candidates = [copy.deepcopy(b) for b in blocks if is_raw_candidate(b) and b.get("bbox") and overlap(bbox, b["bbox"])]
        siblings = [copy.deepcopy(b) for b in blocks if b.get("table_id") == cell["table_id"] and b.get("row") == cell["row"]]
        crop_name = f"images/unit-{block_id}.png"
        clip = [bbox[0] - .002, bbox[1] - .001, bbox[2] + .002, bbox[3] + .001]
        crops.append(render_clip(base_source["path"], clip, crop_name))
        cases.append({
            "case_id": f"unit-{block_id}",
            "page_number": 1,
            "cell": copy.deepcopy(cell),
            "input_candidates": candidates,
            "row_cells": siblings,
            "expected": {"text": text, "quantity_text": quantity, "row": cell["row"], "column": cell["column"], "table_id": cell["table_id"], "bbox": bbox},
            "visual_reference": crop_name,
            "expected_basis": "Manual visual transcription from source PDF render; not historical OCR",
        })
    row = [copy.deepcopy(b) for b in blocks if b.get("table_id") == "p1-t1-part1" and b.get("row") in (0, 1, 2)]
    row_bbox = [.035, .562, .347, .642]
    row_candidates = [copy.deepcopy(b) for b in blocks if is_raw_candidate(b) and b.get("bbox") and overlap(row_bbox, b["bbox"])]
    penoplex = {
        "case_id": "cross-column-material-50-m3",
        "page_number": 1,
        "region": next(r for r in page["regions"] if r["id"] == "p1-r4"),
        "table_cells": row,
        "input_candidates": row_candidates,
        "crossing_native_block_id": "p1-b260",
        "expected": {
            "table_id": "p1-t1-part1", "row": 1,
            "designation": "ТУ 5767-006-54349294-2014",
            "name": "ЭППС 35 Пеноплекс ГЕО (контур здания)",
            "quantity_text": "50", "unit_text": "м³",
            "columns": {"designation": 1, "name": 2, "quantity": 3, "unit": 4},
            "required_association": "one source row; do not duplicate the crossing line into independent rows",
            "allowed_representation": "Keep ambiguous designation/name cells empty and link the whole native line to columns [1,2] and this quantity/unit; splitting text into new cells is not required",
        },
        "visual_reference": "images/cross-column-material.png",
        "expected_basis": "Manual visual transcription from source PDF render",
    }
    crops.append(render_clip(base_source["path"], [.059, .599, .322, .624], penoplex["visual_reference"]))
    base_fixture = {
        "fixture_schema_version": 1,
        "provenance": provenance(base_source, AUDIT / "gi-base.json"),
        "deidentification": "Only five material rows and adjacent public product names/units; no title block, address, person, signature, QR, document UUID or full text",
        "page": {"page_number": 1, "width": page["width"], "height": page["height"], "coordinate_space": "visible-page-normalized"},
        "unit_cases": cases,
        "cross_column_case": penoplex,
    }
    outputs = [write("material-cases.json", base_fixture)]
    rev_page = revision["pages"][0]
    native = [copy.deepcopy(b) for b in rev_page["blocks"] if b["source"] == "native"]
    assert len(native) == 46
    redact = {"p1-b13", "p1-b22", "p1-b23", "p1-b25", "p1-b26", "p1-b27", "p1-b28", "p1-b46"}
    for block in native:
        if block["id"] in redact:
            block["raw_text"] = block["normalized_text"] = "[REDACTED]"
            block["fixture_redacted"] = True
    rev_fixture = {
        "fixture_schema_version": 1,
        "provenance": provenance(rev_source, AUDIT / "gi-rev3.json"),
        "page": {"page_number": 1, "width": rev_page["width"], "height": rev_page["height"], "coordinate_space": "visible-page-normalized"},
        "deidentification": {"method": "Eight identifying text blocks replaced with explicit marker; all 46 original IDs, bboxes, routing flags and region relations retained. No QR image, signatures or full PDF included.", "redacted_block_ids": sorted(redact), "redacted_text_is_gold": False},
        "native_blocks": native,
        "regions": copy.deepcopy(rev_page["regions"]),
        "expected": {
            "native_block_count": 46,
            "accessible_native_block_ids": [b["id"] for b in native],
            "historical_include_in_main_count": 0,
            "revision": {"text": "3", "block_id": "p1-b29"},
            "replaced_sheets": [{"text": "1", "block_id": "p1-b30"}, {"text": "4", "block_id": "p1-b36"}, {"text": "8", "block_id": "p1-b40"}],
            "unknown_region_ocr_allowed": False,
            "retained_reason": "LAYOUT_BOUNDARY_CONFLICT",
            "expectation_scope": "46-block accessibility/locator preservation; visual text truth asserted for revision/table rows only, not redacted markers",
        },
        "visual_reference": "images/revision-table-1-4-8.png",
    }
    crops.append(render_clip(rev_source["path"], [.09, .116, .98, .252], rev_fixture["visual_reference"], scale=3))
    outputs.append(write("revision-native-context.json", rev_fixture))
    outputs.extend(crops)
    manifest = {"schema_version": 1, "status": "diagnostic fixtures rendered; run build_public_raster.py to add the public raster fixtures", "files": outputs, "hidden_source_files_read": 0, "full_source_documents_included": False}
    write("manifest.json", manifest)
    print(json.dumps({"written": len(outputs), "unit_cases": len(cases), "native_revision_blocks": len(native)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
