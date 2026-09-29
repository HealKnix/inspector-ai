"""Verify the committed regression inputs without importing the application."""

import argparse
import hashlib
import json
import struct
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "backend/document-parser/tests/fixtures/native-ocr"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(originals=False):
    manifest = read(FIXTURES / "manifest.json")
    paths = [record["path"] for record in manifest["files"]]
    require(len(paths) == len(set(paths)) == 12, "Expected 12 unique payloads")
    for record in manifest["files"]:
        path = (FIXTURES / record["path"]).resolve()
        require(path.is_relative_to(FIXTURES.resolve()), "Unsafe payload path")
        require(sha(path) == record["sha256"], "Payload hash mismatch: " + record["path"])
        require(path.stat().st_size == record["bytes"], "Payload size mismatch")
        if path.suffix == ".png":
            raw = path.read_bytes()
            require(raw[:8] == b"\x89PNG\r\n\x1a\n", "Invalid PNG")
            require(struct.unpack(">II", raw[16:24]) == (record["image_width"], record["image_height"]), "PNG dimensions differ")
    material = read(FIXTURES / "material-cases.json")
    require(len(material["unit_cases"]) == 5, "Five unit regressions required")
    for case in material["unit_cases"]:
        native = [b for b in case["input_candidates"] if b["source"] == "native"]
        ocr = [b for b in case["input_candidates"] if b["source"] == "ocr"]
        require(any(b["raw_text"] == case["expected"]["text"] for b in native), "Expected unit not supported by native input")
        require(bool(ocr) and all(isinstance(b["confidence"], (int, float)) for b in ocr), "OCR candidates must be actual confidence-bearing observations")
        require(case["cell"]["raw_text"] != case["expected"]["text"], "Historical corruption lost")
    row = material["cross_column_case"]
    require(any(b["id"] == row["crossing_native_block_id"] for b in row["input_candidates"]), "Crossing native line missing")
    require(all(b["raw_text"] == "" for b in row["table_cells"] if b["row"] == 1 and b["column"] in (1, 2)), "Historical empty cells must remain evidence, not repaired input")
    revision = read(FIXTURES / "revision-native-context.json")
    native = revision["native_blocks"]
    require(len(native) == 46 and {b["id"] for b in native} == set(revision["expected"]["accessible_native_block_ids"]), "Missing revision locator")
    require(all(b["source"] == "native" and b["include_in_main"] is False for b in native), "Historical native routing changed")
    require(sum(b.get("fixture_redacted", False) for b in native) == 8, "Expected eight explicit redactions")
    require(all(b["raw_text"] == "[REDACTED]" for b in native if b.get("fixture_redacted")), "Redaction marker missing")
    expected_fields = [revision["expected"]["revision"], *revision["expected"]["replaced_sheets"]]
    require(all(next(b for b in native if b["id"] == field["block_id"])["raw_text"] == field["text"] for field in expected_fields), "Revision field locator mismatch")
    raster = read(FIXTURES / "public-raster-cases.json")
    require(raster["provenance"]["organiser_split"] == "TRAIN_PUBLIC" and raster["provenance"]["object_id"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED", "Incorrect public train role")
    require(len(raster["cases"]) == 2 and all(c["observed_native_character_count"] == 0 and c["observed_image_object_count"] == 1 for c in raster["cases"]), "Raster source evidence missing")
    for case in raster["cases"]:
        require(case["expected"]["text"] == "\n".join(case["expected"]["lines"]), "Raster transcription mismatch")
        require(case["image"] in paths, "Missing raster image")
    original_files = 0
    if originals:
        source_manifest = read(REPO / ".test-output/real-documents-20260926/manifest.json")
        for fixture, artifact_name in [(material, "gi-base.json"), (revision, "gi-rev3.json")]:
            provenance = fixture["provenance"]
            source = next(s for s in source_manifest["files"] if s["sha256"] == provenance["source_sha256"])
            require(sha(Path(source["path"])) == provenance["source_sha256"], "Diagnostic original changed")
            artifact_path = REPO.parent / "tmp/ocr-audit-20260926" / artifact_name
            require(sha(artifact_path) == provenance["artifact_sha256"], "Diagnostic artifact changed")
            by_id = {b["id"]: b for b in read(artifact_path)["pages"][0]["blocks"]}
            if artifact_name == "gi-base.json":
                copied = [b for c in fixture["unit_cases"] for b in [c["cell"], *c["input_candidates"], *c["row_cells"]]]
                copied += fixture["cross_column_case"]["input_candidates"] + fixture["cross_column_case"]["table_cells"]
                require(all(b == by_id[b["id"]] for b in copied), "Copied material block differs from original")
            else:
                for block in fixture["native_blocks"]:
                    for key, value in by_id[block["id"]].items():
                        if block.get("fixture_redacted") and key in ("raw_text", "normalized_text"):
                            continue
                        require(block[key] == value, "Revision locator/routing changed")
            original_files += 1
        package = REPO.parent / "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ"
        public_manifest_path = package / "02_ФОРМАТ_ДАННЫХ_И_ПРИМЕРЫ/data/document_manifest.jsonl"
        require(sha(public_manifest_path) == raster["provenance"]["organiser_manifest_sha256"], "Public manifest changed")
        permitted = read(REPO / "docs/acceptance/contracts/permitted-manifest.json")
        public_row = next(x for x in permitted if x["file_id"] == raster["provenance"]["source_file_id"])
        require(public_row["split"] == "TRAIN_PUBLIC" and public_row["object_id"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED", "Refusing validation/hidden input")
        public_source = (package / "01_ДОКУМЕНТАЦИЯ" / raster["provenance"]["source_relative_path"]).resolve()
        require(public_source.is_relative_to((package / "01_ДОКУМЕНТАЦИЯ").resolve()), "Unsafe public source path")
        require(sha(public_source) == public_row["sha256"] == raster["provenance"]["source_sha256"], "Public original changed")
        original_files += 1
    return {"schema_version": 1, "passed": True, "manifest_sha256": sha(FIXTURES / "manifest.json"), "payloads_verified": len(paths), "unit_cases": 5, "cross_column_cases": 1, "native_revision_blocks": 46, "redacted_revision_blocks": 8, "raster_pages": 2, "original_files_verified": original_files, "hidden_files_read": 0, "validation_files_read": 0, "model_quality_claim": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--originals", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = verify(args.originals)
    if args.report:
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
