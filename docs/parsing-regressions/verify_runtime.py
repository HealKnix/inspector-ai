"""Compare actual model-run artifacts with the pinned, visual regression inputs.

No application import, model call, PDF modification, or private text in reports.
Run from the repository root, for example:
  python docs/parsing-regressions/verify_runtime.py --results <run>/results \
    --report docs/parsing-regressions/runtime-verification.json

Exit codes: 0 all scoped checks pass; 1 a completed check fails; 2 incomplete run.
This checks nine development regressions, not CER/WER or corpus acceptance.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import unicodedata

from verify_fixtures import FIXTURES, REPO, read, require, sha, verify

EPSILON = 1e-6
CELL_IOU_MIN = 0.8


def text(value):
    """NFC and whitespace only; case, punctuation, letters and digits survive."""
    return " ".join(unicodedata.normalize("NFC", value).split())


def same_box(first, second):
    return len(first) == len(second) == 4 and max(abs(a - b) for a, b in zip(first, second)) <= EPSILON


def intersection(first, second):
    return max(0, min(first[2], second[2]) - max(first[0], second[0])) * max(0, min(first[3], second[3]) - max(first[1], second[1]))


def area(box):
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def iou(first, second):
    common = intersection(first, second)
    return common / max(1e-15, area(first) + area(second) - common)


def selected(block):
    return block.get("include_in_main") is True and block.get("provenance", {}).get("status") == "selected" and block.get("native_valid") is not False


def ambiguous(block):
    prov = block.get("provenance", {})
    return block.get("include_in_main") is False and prov.get("status") == "ambiguous" and bool(prov.get("reasons")) and bool(prov.get("fragments"))


def matches_fragment(fragment, original):
    return fragment.get("source") == "native" and fragment.get("native_valid") is True and fragment.get("raw_text") == original["raw_text"] and same_box(fragment.get("bbox", []), original["bbox"])


def fragment_available(block, original, role=None):
    return any(matches_fragment(f, original) and (role is None or f.get("role") == role) for f in block.get("provenance", {}).get("fragments", []))


def exact_native(blocks, original):
    return [b for b in blocks if b.get("kind") == "text" and b.get("source") == "native" and b.get("raw_text") == original["raw_text"] and same_box(b.get("bbox", []), original["bbox"])]


def analysis_eligible(block, regions):
    """Documented consumer contract; the separate TS tests exercise its code."""
    prov = block.get("provenance", {})
    if block.get("native_valid") is False or prov.get("status") == "ambiguous" or "DUPLICATE_NATIVE_READING" in prov.get("reasons", []):
        return False
    return block.get("include_in_main") is True or (block.get("source") == "native" and block.get("native_valid") is True and regions.get(block.get("region_id"), {}).get("method") == "skipped")


def units(fixture, page):
    results = []
    for case in fixture["unit_cases"]:
        expected = case["expected"]
        natives = [b for b in case["input_candidates"] if b["source"] == "native" and b["raw_text"] == expected["text"]]
        require(len(natives) == 1, "Unit fixture must have one exact native reference")
        native = natives[0]
        cells = [b for b in page["blocks"] if b["kind"] == "table_cell" and iou(b["bbox"], expected["bbox"]) >= CELL_IOU_MIN]
        checks = {"unique_cell_at_reference_geometry": len(cells) == 1,
                  "original_native_text_and_bbox_retained": len(exact_native(page["blocks"], native)) == 1}
        result = {"case_id": case["case_id"], "historical_cell_id": case["cell"]["id"], "expected_bbox": expected["bbox"], "checks": checks}
        if len(cells) == 1:
            cell = cells[0]
            prov = cell.get("provenance", {})
            exact = selected(cell) and cell["raw_text"] == expected["text"] and fragment_available(cell, native, "selected")
            abstained = ambiguous(cell) and fragment_available(cell, native)
            row_cells = [b for b in page["blocks"] if b.get("table_id") == cell["table_id"] and b.get("row") == cell["row"]]
            unsafe = [b for b in page["blocks"] if b["kind"] == "text" and selected(b) and intersection(b["bbox"], native["bbox"]) / max(1e-15, min(area(b["bbox"]), area(native["bbox"]))) >= 0.5 and text(b["raw_text"]) != text(expected["text"])]
            checks.update(exact_or_explicitly_ambiguous=exact or abstained,
                          row_and_column_preserved=cell.get("row") == expected["row"] and cell.get("column") == expected["column"],
                          quantity_in_same_row=any(selected(b) and b["raw_text"] == expected["quantity_text"] for b in row_cells),
                          no_selected_wrong_reading_at_native_locator=not unsafe)
            result.update(actual_cell_id=cell["id"], actual_table_id=cell["table_id"],
                          outcome="selected_correct" if exact else "explicitly_ambiguous" if abstained else "failed",
                          fragment_sources=sorted({f["source"] for f in prov.get("fragments", [])}),
                          alternative_fragment_count=sum(f.get("role") == "alternative" for f in prov.get("fragments", [])))
        else:
            result["outcome"] = "missing_or_nonunique_cell"
        result["passed"] = all(checks.values())
        results.append(result)
    return results


def cross_column(fixture, page):
    case = fixture["cross_column_case"]
    original = next(b for b in case["input_candidates"] if b["id"] == case["crossing_native_block_id"])
    matches = exact_native(page["blocks"], original)
    checks = {"one_original_whole_line_retained": len(matches) == 1}
    result = {"case_id": "cross-column-material", "historical_native_id": original["id"], "bbox": original["bbox"], "checks": checks}
    if len(matches) == 1:
        block = matches[0]
        link = block.get("table_link", {})
        expected = case["expected"]
        columns = expected["columns"]
        row = [b for b in page["blocks"] if b.get("kind") == "table_cell" and b.get("table_id") == link.get("table_id") and b.get("row") == expected["row"]]
        checks.update(native_selected_and_located=selected(block) and fragment_available(block, original, "selected"),
                      exact_resolved_link=link.get("status") == "associated" and bool(link.get("table_id")) and link.get("rows") == [expected["row"]] and link.get("columns") == [columns["designation"], columns["name"]],
                      same_row_quantity=any(b.get("column") == columns["quantity"] and selected(b) and b["raw_text"] == expected["quantity_text"] for b in row),
                      same_row_unit=any(b.get("column") == columns["unit"] and selected(b) and b["raw_text"] == expected["unit_text"] for b in row))
        result.update(actual_native_id=block["id"], table_link=link,
                      empty_designation_name_cells=sum(b.get("column") in [columns["designation"], columns["name"]] and not b["raw_text"] for b in row))
    result["passed"] = all(checks.values())
    return result


def revision(fixture, page, baseline_path, case_summary):
    require(sha(baseline_path) == fixture["provenance"]["artifact_sha256"], "Revision private baseline hash mismatch")
    baseline = {b["id"]: b for b in read(baseline_path)["pages"][0]["blocks"]}
    regions = {r["id"]: r for r in page["regions"]}
    rows = []
    for original in fixture["native_blocks"]:
        reference = baseline[original["id"]]
        matches = exact_native(page["blocks"], reference)
        match = matches[0] if len(matches) == 1 else {}
        owner = regions.get(match.get("region_id"), {})
        historical_owner = next(r for r in fixture["regions"] if r["id"] == original["region_id"])
        reasons = set(historical_owner["reasons"]) & {fixture["expected"]["retained_reason"]}
        checks = {"unique_original_text_and_bbox": len(matches) == 1,
                  "original_normalized_text_retained": match.get("normalized_text") == reference["normalized_text"],
                  "valid_native_with_selected_fragment": match.get("native_valid") is True and match.get("provenance", {}).get("status") == "selected" and fragment_available(match, reference, "selected"),
                  "analysis_eligible_by_contract": analysis_eligible(match, regions),
                  "region_locator_present": bool(owner),
                  "original_structural_path_retained": bool(match) and match.get("structural_path") == reference.get("structural_path"),
                  "boundary_conflict_reason_retained": reasons.issubset(set(owner.get("reasons", [])))}
        rows.append({"historical_id": original["id"], "actual_id": match.get("id"),
                     "text_redacted_in_fixture": original.get("fixture_redacted", False),
                     "checks": checks, "passed": all(checks.values())})
    fields = [fixture["expected"]["revision"], *fixture["expected"]["replaced_sheets"]]
    by_original = {r["historical_id"]: r for r in rows}
    checks = {"all_46_blocks_preserved_and_eligible": len(rows) == 46 and all(r["passed"] for r in rows),
              "one_to_one_actual_locators": len({r["actual_id"] for r in rows if r["actual_id"]}) == 46,
              "revision_and_three_replaced_sheet_locators": all(by_original[f["block_id"]]["passed"] and text(baseline[f["block_id"]]["raw_text"]) == f["text"] for f in fields),
              "unknown_and_graphic_regions_not_recognized": all(r["method"] == "skipped" for r in page["regions"] if r["kind"] in ("graphic", "unknown")),
              "zero_actual_recognition_calls": case_summary["calls"]["line_recognition"] == 0 and case_summary["calls"]["recognized_line_crops"] == 0}
    return {"case_id": "revision-native-46", "baseline_artifact_sha256": sha(baseline_path),
            "private_baseline_text_read_only": True, "private_text_exported": False,
            "blocks": rows, "checks": checks, "passed": all(checks.values())}


def raster(fixture, artifact, case_summary):
    results = []
    page_map = case_summary["original_page_numbers"]
    for case in fixture["cases"]:
        page = artifact["pages"][page_map.index(case["source_page_number"])]
        box = case["source_bbox"]
        inside = [b for b in page["blocks"] if b.get("source") == "ocr" and intersection(box, b["bbox"]) / max(1e-15, area(b["bbox"])) >= 0.8]
        ordered = sorted((b for b in inside if selected(b)), key=lambda b: (b["bbox"][1], b["bbox"][0]))
        checks = {"expected_printed_text_exact_after_NFC_whitespace": text(" ".join(b["raw_text"] for b in ordered)) == text(case["expected"]["text"]),
                  "every_fixture_line_has_one_located_exact_match": all(sum(text(b["raw_text"]) == text(line) for b in ordered) == 1 for line in case["expected"]["lines"]),
                  "actual_source_has_no_native_text": not any(b.get("source") == "native" and b["raw_text"].strip() for b in page["blocks"]),
                  "actual_recognition_executed": case_summary["calls"]["line_recognition"] > 0}
        results.append({"case_id": case["case_id"], "original_page_number": case["source_page_number"],
                        "artifact_page_number": page["page_number"], "source_bbox": box,
                        "selected_block_ids": [b["id"] for b in ordered],
                        "expected_line_count": len(case["expected"]["lines"]),
                        "selected_line_count": len(ordered), "ambiguous_line_count": sum(ambiguous(b) for b in inside),
                        "checks": checks, "passed": all(checks.values())})
    return results


def run(results_path, baseline_path):
    fixture_check = verify()
    material = read(FIXTURES / "material-cases.json")
    rev = read(FIXTURES / "revision-native-context.json")
    scan = read(FIXTURES / "public-raster-cases.json")
    expected_sources = {"gi-base-p1": (material["provenance"]["source_sha256"], [1]),
                        "gi-rev3-p1": (rev["provenance"]["source_sha256"], [1]),
                        "public-f0152-p8-p9": (scan["provenance"]["source_sha256"], [8, 9])}
    require(results_path.resolve().is_relative_to(REPO.resolve()), "Results must be within this repository")
    summary_path = results_path / "summary.json"
    report = {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
              "scope": "Nine declared development regressions from actual local model execution; historical fixtures supply reference geometry and visual expectations only",
              "input_kind": "actual_local_model_run_artifacts", "historical_replay_is_runtime_evidence": False,
              "verifier_sha256": sha(Path(__file__)), "fixture_manifest_sha256": fixture_check["manifest_sha256"],
              "results_directory": results_path.resolve().relative_to(REPO.resolve()).as_posix(),
              "method": {"native_bbox_absolute_tolerance": EPSILON, "table_cell_minimum_iou": CELL_IOU_MIN,
                         "text_normalization": "NFC and whitespace only; no case folding or OCR repair", "match_uses_stable_block_ids": False,
                         "revision_text": "Exact private historical native bytes compared locally, including eight redacted fixture blocks; no private text exported",
                         "consumer_scope": "Artifact eligibility against documented analysisBlocks contract; separate TypeScript tests exercise actual consumers"},
              "limitations": ["Known development examples and two crops of one public-train document; not independent validation or hidden test",
                              "No full-page gold; no CER/WER, corpus accuracy, H100 or SLA claim",
                              "Model execution is evidenced by the hashed probe summary and artifacts; this verifier does not invoke models",
                              "Actual scan capture DPI is unknown; these crops do not prove the >=300 dpi acceptance condition"],
              "hidden_files_read": 0, "validation_files_read": 0, "private_text_exported": False}
    if not summary_path.exists():
        return {**report, "status": "pending", "passed": False, "pending": list(expected_sources)}
    summary = read(summary_path)
    completed = {c["id"]: c for c in summary["cases"]}
    missing = [key for key in expected_sources if key not in completed or not (results_path / (key + ".artifact.json")).exists()]
    if missing:
        return {**report, "status": "pending", "passed": False, "pending": missing}
    require(set(completed) == set(expected_sources) and summary["completed_cases"] == summary["expected_cases"] == 3, "Unexpected run case set")
    inputs_path = results_path.parent / "inputs.json"
    inputs = {c["id"]: c for c in read(inputs_path)["cases"]}
    require(set(inputs) == set(expected_sources), "Unexpected declared source set")
    artifacts = {}
    bindings = []
    for key, (source_hash, pages) in expected_sources.items():
        case = completed[key]
        artifact_path = results_path / (key + ".artifact.json")
        artifact = read(artifact_path)
        copy_path = results_path.parent / "original-copies" / (key + ".pdf")
        require(inputs[key]["source_sha256"] == case["source_sha256"] == source_hash == sha(copy_path), "Original source binding failed: " + key)
        require(inputs[key]["page_numbers"] == case["original_page_numbers"] == pages, "Original page binding failed: " + key)
        require(sha(artifact_path) == case["artifact_sha256"], "Actual artifact hash mismatch: " + key)
        require(artifact["source_sha256"] == case["selected_pdf_sha256"], "Selected PDF binding failed: " + key)
        require(artifact["pipeline_fingerprint"] == case["pipeline_fingerprint"], "Pipeline binding failed: " + key)
        require(artifact["versions"] == summary["versions"], "Runtime version binding failed: " + key)
        require(len(artifact["pages"]) == len(pages), "Artifact page count mismatch: " + key)
        require(case["original_unchanged"] is True and case["excluded_regions_not_recognized"] is True and case["calls"]["layout"] == len(pages), "Runtime execution/preservation evidence missing: " + key)
        artifacts[key] = artifact
        bindings.append({name: case[name] for name in ("id", "suite", "source_sha256", "original_page_numbers", "selected_pdf_sha256", "artifact_sha256", "pipeline_fingerprint", "seconds", "calls", "quality", "reasons")})
    checks = units(material, artifacts["gi-base-p1"]["pages"][0])
    require(len({a["pipeline_fingerprint"] for a in artifacts.values()}) == 1, "Mixed runtime pipelines")
    checks.append(cross_column(material, artifacts["gi-base-p1"]["pages"][0]))
    checks.append(revision(rev, artifacts["gi-rev3-p1"]["pages"][0], baseline_path, completed["gi-rev3-p1"]))
    checks.extend(raster(scan, artifacts["public-f0152-p8-p9"], completed["public-f0152-p8-p9"]))
    passed = all(c["passed"] for c in checks)
    return {**report, "status": "passed" if passed else "failed", "passed": passed,
            "summary_sha256": sha(summary_path), "run_inputs_sha256": sha(inputs_path),
            "device": summary["device"], "cpu_threads": summary["cpu_threads"],
            "model_manifest_sha256": summary["versions"]["models_sha256"],
            "parser_source_sha256": summary["versions"]["source_sha256"],
            "source_and_artifact_bindings": bindings, "case_count": len(checks),
            "passed_cases": sum(c["passed"] for c in checks), "cases": checks}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--revision-baseline", type=Path, default=REPO.parent / "tmp/ocr-audit-20260926/gi-rev3.json")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = run(args.results, args.revision_baseline)
    if args.report:
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result.get(key) for key in ("status", "case_count", "passed_cases", "pending")}))
    if result["status"] == "failed":
        print(json.dumps([{"case_id": c["case_id"], "failed_checks": [name for name, value in c["checks"].items() if not value]} for c in result["cases"] if not c["passed"]]))
    raise SystemExit(0 if result["passed"] else 2 if result["status"] == "pending" else 1)
