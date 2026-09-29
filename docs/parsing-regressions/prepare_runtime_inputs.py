"""Prepare local-only, hash-checked inputs for the coordinated model run."""

import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MATERIALS = REPO.parent
PACKAGE = MATERIALS / "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ"


def main():
    diagnostic = json.loads((REPO / ".test-output/real-documents-20260926/manifest.json").read_text(encoding="utf-8"))
    public_manifest = PACKAGE / "02_ФОРМАТ_ДАННЫХ_И_ПРИМЕРЫ/data/document_manifest.jsonl"
    public = [json.loads(line) for line in public_manifest.read_text(encoding="utf-8").splitlines() if line]
    rows = []
    for case_id, prefix in [("gi-base-p1", "04dcef6b"), ("gi-rev3-p1", "b8b03fee")]:
        item = next(x for x in diagnostic["files"] if x["sha256"].startswith(prefix))
        rows.append({"id": case_id, "suite": "authorised-diagnostic-regression", "source_path": item["path"], "source_sha256": item["sha256"], "page_numbers": [1]})
    item = next(x for x in public if x["file_id"] == "F0152")
    assert item["split"] == "TRAIN_PUBLIC" and item["object_id"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED"
    rows.append({"id": "public-F0152-p8-p9", "suite": "public-train-raster-regression", "source_path": str(PACKAGE / "01_ДОКУМЕНТАЦИЯ" / item["relative_path"]), "source_sha256": item["sha256"], "page_numbers": [8, 9], "file_id": item["file_id"], "object_id": item["object_id"], "organiser_split": item["split"]})
    for row in rows:
        path = Path(row["source_path"]).resolve()
        assert path.is_relative_to(MATERIALS.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["source_sha256"]
        row["source_path"] = path.as_posix()
        row["source_path_relative_to_inputs_mount"] = path.relative_to(MATERIALS).as_posix()
        row["container_source_path"] = "/inputs/" + row["source_path_relative_to_inputs_mount"]
    output = REPO / ".test-output/par-native-ocr-20260927-inputs.json"
    output.write_text(json.dumps({"schema_version": 1, "inputs_mount_host": MATERIALS.as_posix(), "inputs_mount_container": "/inputs", "hidden_files_read": 0, "sources": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"path": str(output), "sources": len(rows), "pages": sum(len(x["page_numbers"]) for x in rows)}))


if __name__ == "__main__":
    main()
