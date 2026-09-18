"""Explicit, offline local validation. Inputs/results must stay outside the repository."""
import argparse
import dataclasses
import json
import shutil
import time
import uuid
from pathlib import Path

from common import ParseError, normalize
from config import Settings, digest_file, fingerprint
from server import Supervisor


def edit_distance(a, b):
    if len(a) * len(b) > 30_000_000:
        raise ValueError("Ground-truth comparison too large; annotate selected pages or excerpts")
    if len(a) > len(b):
        a, b = b, a
    previous = list(range(len(a) + 1))
    for row, right in enumerate(b, 1):
        current = [row]
        for column, left in enumerate(a, 1):
            current.append(min(current[-1] + 1, previous[column] + 1, previous[column - 1] + (left != right)))
        previous = current
    return previous[-1]


def accuracy(actual, expected):
    actual, expected = normalize(actual), normalize(expected)
    expected_words, actual_words = expected.split(), actual.split()
    return {"character_error_rate": edit_distance(actual, expected) / max(1, len(expected)),
            "word_error_rate": edit_distance(actual_words, expected_words) / max(1, len(expected_words)),
            "reference_characters": len(expected), "reference_words": len(expected_words)}


def outside_repo(path):
    repo = Path(__file__).resolve().parents[2]
    result = path.resolve()
    if result == repo or repo in result.parents:
        raise ValueError("Keep documents, annotations and results outside the repository")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path,
                        help='JSON array: {"path": relative source, "id": non-sensitive label, optional "truth": {"text": ..., "page_number": 1}}')
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--models", required=True, type=Path)
    parser.add_argument("--font", type=Path)
    args = parser.parse_args()
    source_root, output = outside_repo(args.source_root), outside_repo(args.output)
    cases = json.loads(outside_repo(args.manifest).read_text(encoding="utf-8-sig"))
    output.mkdir(parents=True, exist_ok=True)
    storage = output / "storage"
    (storage / "originals").mkdir(parents=True, exist_ok=True)
    (storage / "derived").mkdir(parents=True, exist_ok=True)
    settings = dataclasses.replace(Settings.environment(), storage=storage, models=args.models.resolve())
    if args.font:
        settings = dataclasses.replace(settings, font=args.font.resolve())
    versions = settings.versions()
    report = {"purpose": "Local validation, not independent hidden acceptance or a guarantee of OCR accuracy",
              "pipeline_fingerprint": fingerprint(versions), "versions": versions, "cases": []}
    initialized = time.perf_counter()
    supervisor = Supervisor(settings, versions)
    try:
        while True:
            try:
                supervisor.health()
                break
            except ParseError:
                if time.perf_counter() - initialized > 180:
                    raise RuntimeError("Offline OCR model initialization failed") from None
                time.sleep(.1)
        report["initialization_seconds"] = round(time.perf_counter() - initialized, 3)
        for index, case in enumerate(cases):
            source = (source_root / case["path"]).resolve()
            source.relative_to(source_root)
            if not source.is_file() or source.suffix.lower() not in (".pdf", ".docx", ".xml"):
                raise ValueError("Invalid validation input")
            key = str(uuid.uuid4())
            shutil.copyfile(source, storage / "originals" / key)
            request = {"schema_version": 1, "request_id": str(uuid.uuid4()), "storage_key": key,
                       "source_sha256": digest_file(source), "format": source.suffix[1:].lower()}
            item = {"id": case.get("id", f"case-{index + 1}"), "format": request["format"],
                    "source_sha256": request["source_sha256"]}
            started = time.perf_counter()
            try:
                artifact = supervisor.run(request)
                destination = output / f"artifact-{index + 1}.json"
                destination.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
                item.update({"quality": artifact["quality"], "coverage": artifact["coverage"],
                             "reasons": artifact["reasons"], "characters": len(artifact["raw_text"]),
                             "blocks": sum(len(page["blocks"]) for page in artifact["pages"]),
                             "table_cells": sum(block["kind"] == "table_cell" for page in artifact["pages"] for block in page["blocks"])})
                if "truth" in case:
                    truth = case["truth"]
                    page = artifact["pages"][truth["page_number"] - 1]
                    actual = "\n".join(block["raw_text"] for block in page["blocks"])
                    item["annotated_page"] = truth["page_number"]
                    item["accuracy"] = accuracy(actual, truth["text"])
                else:
                    item["accuracy"] = None
            except ParseError as error:
                item.update({"error_code": error.code.lower(), "retryable": error.retryable})
            item["seconds"] = round(time.perf_counter() - started, 3)
            report["cases"].append(item)
            (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({key: item[key] for key in ("id", "seconds", "quality", "error_code") if key in item}), flush=True)
    finally:
        supervisor.stop()


if __name__ == "__main__":
    main()
