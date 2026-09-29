"""Render minimal print-only excerpts from two real public scanned pages.

The source is allowed TRAIN_PUBLIC, not the development-validation object.
No organiser labels, overlay PDFs, hidden files, image synthesis or OCR is used.
"""

import importlib.metadata
import json

import pypdfium2 as pdfium

from build_diagnostic_fixtures import MATERIALS, OUT, REPO, digest, read, render_clip, write


def main():
    package = MATERIALS / "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ"
    public_path = package / "02_ФОРМАТ_ДАННЫХ_И_ПРИМЕРЫ/data/document_manifest.jsonl"
    assert digest(public_path) == "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
    manifest_rows = [json.loads(line) for line in public_path.read_text(encoding="utf-8").splitlines() if line]
    row = next(x for x in manifest_rows if x["file_id"] == "F0152")
    assert row["split"] == "TRAIN_PUBLIC" and row["object_id"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED"
    permitted_path = REPO / "docs/acceptance/contracts/permitted-manifest.json"
    permitted = next(x for x in read(permitted_path) if x["file_id"] == row["file_id"])
    assert permitted["sha256"] == row["sha256"] and not permitted["excluded"]
    assert permitted["object_id"] == row["object_id"] and permitted["split"] == row["split"]
    source = (package / "01_ДОКУМЕНТАЦИЯ" / row["relative_path"]).resolve()
    assert source.is_relative_to((package / "01_ДОКУМЕНТАЦИЯ").resolve())
    assert digest(source) == row["sha256"]
    document = pdfium.PdfDocument(source)
    specs = [
        (8, [.195, .328, .857, .409], [
            "СВИДЕТЕЛЬСТВО",
            "о допуске к определенному виду или видам работ, которые оказывают",
            "влияние на безопасность объектов капитального строительства",
        ]),
        (9, [.24, .288, .83, .331], [
            "ВЫПИСКА ИЗ РЕЕСТРА ЧЛЕНОВ САМОРЕГУЛИРУЕМОЙ",
            "ОРГАНИЗАЦИИ",
        ]),
    ]
    cases = []
    images = []
    for page_number, bbox, expected_lines in specs:
        page = document[page_number - 1]
        textpage = page.get_textpage()
        native_chars = textpage.count_chars()
        textpage.close()
        image_count = sum(1 for _ in page.get_objects(filter=[3]))
        assert native_chars == 0 and image_count == 1
        image_path = f"images/public-F0152-p{page_number}-printed.png"
        image = render_clip(source, bbox, image_path, scale=3, page_number=page_number)
        images.append(image)
        cases.append({
            "case_id": f"public-raster-F0152-p{page_number}",
            "source_file_id": row["file_id"],
            "source_page_number": page_number,
            "source_bbox": bbox,
            "coordinate_space": "visible-page-normalized",
            "source_width_points": page.get_width(),
            "source_height_points": page.get_height(),
            "observed_native_character_count": native_chars,
            "observed_image_object_count": image_count,
            "image": image_path,
            "expected": {"lines": expected_lines, "text": "\n".join(expected_lines), "structure": "printed heading and its continuation lines; line wrapping may be evaluated separately"},
            "deidentification": "Original PDF rendered only within the title clip; addresses, identifiers, organisations, people, signatures and seals outside the clip are not distributed",
            "raster_origin": "Existing scanned page with one embedded image and no native characters; not a rasterised synthetic test PDF",
            "original_capture_dpi": None,
            "acceptance_eligible_300dpi": None,
        })
        page.close()
    document.close()
    fixture = {
        "fixture_schema_version": 1,
        "provenance": {
            "source_file_id": row["file_id"], "source_sha256": row["sha256"], "source_bytes": row["size_bytes"],
            "source_relative_path": row["relative_path"], "object_id": row["object_id"], "organiser_split": row["split"],
            "development_role": "train-public-diagnostic-regression",
            "organiser_manifest_sha256": digest(public_path), "permitted_manifest_sha256": digest(permitted_path),
            "annotation_source": "None; visual transcription of original print; supplied annotations/gold not read",
        },
        "cases": cases,
    }
    fixture_file = write("public-raster-cases.json", fixture)
    manifest = read(OUT / "manifest.json")
    manifest["files"] = [x for x in manifest["files"] if not (x["path"] == "public-raster-cases.json" or x["path"].startswith("images/public-F0152-"))]
    manifest["files"].extend([fixture_file, *images])
    manifest.update({
        "status": "visually_transcribed_regression_inputs; not expert-approved quality gold",
        "suite_version": "par-native-ocr-regressions-v1",
        "case_counts": {"unit_conflicts": 5, "cross_column_material": 1, "revision_native_context": 1, "real_raster_pages": 2},
        "renderer": {"name": "pypdfium2", "version": importlib.metadata.version("pypdfium2")},
        "review": {"method": "Assistant visual inspection of original-source PDF renders, checked again after cropping", "date": "2026-09-27", "human_expert_approved": False, "expected_from_historical_ocr": False},
        "data_roles": {"authorised_diagnostic": "Known user-authorised material outside the organiser manifest", "public_raster": "TRAIN_PUBLIC / OBJ-TYUMENSKAYA-5-GOLD-SEED; used for development", "validation": "OBJ-NOVOSLOBODSKAYA unchanged and not opened for these fixtures", "hidden": "OBJ-RECHNIKOV-7-7 excluded; no files/answers read"},
        "limitations": ["Two raster pages from one public document are not independent corpus accuracy", "Original scan DPI is unconfirmed; render scale does not prove 300dpi eligibility", "Revision fixture redacts eight identifying text blocks; only structural preservation is asserted for them", "Real OCR/model runs and expert GOLD acceptance are separate evidence"],
    })
    write("manifest.json", manifest)
    print(json.dumps({"files": len(manifest["files"]), "raster_pages": len(cases), "hidden_files_read": 0}))


if __name__ == "__main__":
    main()
