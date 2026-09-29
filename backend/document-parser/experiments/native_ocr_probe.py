"""Run the actual regional parser on declared local pages, with no model mocks.

Inputs must have predeclared SHA-256 and page numbers. Full artifacts and page
images belong in an ignored/private output directory; only the summary is safe
to publish. A selected page is copied to a temporary PDF without rasterization.
Its relationship to the immutable parent PDF is recorded explicitly.
"""
import argparse
from collections import Counter
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import resource
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf

from config import Settings, digest_file
from ocr import LocalOCR
from pipeline import parse


class MeasuredOCR:
    def __init__(self, delegate):
        self.delegate = delegate
        self.reset()

    def reset(self):
        self.calls = {"layout": 0, "line_detection": 0, "line_recognition": 0,
                      "recognized_line_crops": 0, "table_structure": 0}

    def layout(self, image):
        self.calls["layout"] += 1
        return self.delegate.layout(image)

    def detect_lines(self, image):
        self.calls["line_detection"] += 1
        return self.delegate.detect_lines(image)

    def recognize_lines(self, image, polygons):
        self.calls["line_recognition"] += 1
        self.calls["recognized_line_crops"] += len(polygons)
        return self.delegate.recognize_lines(image, polygons)

    def structure_region(self, image, lines):
        self.calls["table_structure"] += 1
        return self.delegate.structure_region(image, lines)


def native_lines(document):
    flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
    return Counter("".join(span["text"] for span in line["spans"])
                   for page in document
                   for native in page.get_text("dict", flags=flags)["blocks"]
                   for line in native.get("lines", [])
                   if "".join(span["text"] for span in line["spans"]).strip())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    inputs = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    cases = inputs["cases"]
    if not cases or len(cases) > 12:
        raise ValueError("Expected 1..12 declared cases")
    for case in cases:
        if case["suite"] not in ("authorized-diagnostic", "TRAIN_PUBLIC_PROBE"):
            raise ValueError("Undeclared corpus is not allowed")
        if digest_file(Path(case["source_path"])) != case["source_sha256"]:
            raise ValueError("Declared source hash mismatch")
        if not case["page_numbers"] or len(case["page_numbers"]) > 3:
            raise ValueError("Expected 1..3 selected original pages")
    args.output.mkdir(parents=True, exist_ok=True)
    settings = replace(Settings.environment(), storage=args.output / "storage")
    (settings.storage / "originals").mkdir(parents=True, exist_ok=True)
    (settings.storage / "derived").mkdir(parents=True, exist_ok=True)
    versions = settings.versions()
    print(json.dumps({"event": "loading_local_models", "cases": len(cases)}), flush=True)
    reader = MeasuredOCR(LocalOCR(settings))
    reports = []
    for index, case in enumerate(cases, 1):
        identifier = case["id"]
        if not identifier or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in identifier):
            raise ValueError("Unsafe case identifier")
        with pymupdf.open(case["source_path"]) as original, pymupdf.open() as selected:
            for page_number in case["page_numbers"]:
                if type(page_number) is not int or not 1 <= page_number <= original.page_count:
                    raise ValueError("Invalid original page number")
                selected.insert_pdf(original, from_page=page_number - 1, to_page=page_number - 1)
            expected_native = native_lines(selected)
            data = selected.tobytes()
        key = str(uuid.uuid4())
        selected_hash = hashlib.sha256(data).hexdigest()
        (settings.storage / "originals" / key).write_bytes(data)
        request = {"schema_version": 1, "request_id": str(uuid.uuid4()), "storage_key": key,
                   "source_sha256": selected_hash, "format": "pdf"}
        reader.reset()
        print(json.dumps({"event": "case_started", "case": identifier, "index": index}), flush=True)
        started = time.perf_counter()
        artifact = parse(request, settings, versions, reader, lambda *_: None)
        elapsed = time.perf_counter() - started
        blocks = [item for page in artifact["pages"] for item in page["blocks"]]
        regions = [item for page in artifact["pages"] for item in page["regions"]]
        retained_native = Counter(item["raw_text"] for item in blocks
                                  if item["source"] == "native" and item["kind"] == "text")
        missing_native = sum((expected_native - retained_native).values())
        artifact_path = args.output / f"{identifier}.artifact.json"
        artifact_path.write_text(json.dumps(artifact, ensure_ascii=False), encoding="utf-8")
        summary = {
            "id": identifier, "suite": case["suite"], "source_sha256": case["source_sha256"],
            "original_page_numbers": case["page_numbers"], "selected_pdf_sha256": selected_hash,
            "selection": "Original PDF pages copied without rasterization; artifact page N maps to original_page_numbers[N-1]",
            "artifact_sha256": digest_file(artifact_path), "pipeline_fingerprint": artifact["pipeline_fingerprint"],
            "seconds": round(elapsed, 3), "calls": dict(reader.calls),
            "source_native_lines": sum(expected_native.values()), "missing_native_lines": missing_native,
            "native_valid_blocks": sum(item.get("native_valid") is True for item in blocks),
            "provenance_blocks": sum("provenance" in item for item in blocks),
            "table_links": dict(Counter(item["table_link"]["status"] for item in blocks if "table_link" in item)),
            "region_methods": dict(Counter(item["method"] for item in regions)),
            "excluded_regions_not_recognized": all(item["method"] == "skipped" for item in regions if item["kind"] in ("graphic", "unknown")),
            "original_unchanged": digest_file(Path(case["source_path"])) == case["source_sha256"],
            "quality": artifact["quality"], "reasons": artifact["reasons"],
        }
        if missing_native or not summary["original_unchanged"] or not summary["excluded_regions_not_recognized"]:
            raise AssertionError("Original/native preservation or excluded-region routing failed")
        reports.append(summary)
        print(json.dumps({"event": "case_completed", "case": identifier,
                          "seconds": summary["seconds"], "calls": summary["calls"]}), flush=True)
        report = {"schema_version": 1, "versions": versions, "device": "cpu", "cpu_threads": settings.cpu_threads,
                  "max_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                  "scope": "Actual local model and parser execution on declared diagnostic pages; not hidden acceptance or a corpus accuracy score",
                  "completed_cases": len(reports), "expected_cases": len(cases), "cases": reports}
        (args.output / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
