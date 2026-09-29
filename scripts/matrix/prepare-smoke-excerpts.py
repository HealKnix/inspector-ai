"""Exact authorized pages for the bounded PAR smoke, never a new gold corpus."""
import hashlib
import json
from pathlib import Path
import sys

import fitz

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
destination.mkdir(exist_ok=True)
manifest = json.loads((source / "inputs.json").read_text(encoding="utf-8"))
cases = []
for item in manifest["cases"]:
    original = source / "original-copies" / Path(item["source_path"]).name
    original_bytes = original.read_bytes()
    assert hashlib.sha256(original_bytes).hexdigest() == item["source_sha256"]
    document = fitz.open(stream=original_bytes, filetype="pdf")
    excerpt = fitz.open()
    for page in item["page_numbers"]:
        excerpt.insert_pdf(document, from_page=page - 1, to_page=page - 1)
    output = destination / (item["id"] + "-excerpt.pdf")
    if output.exists():
        raise RuntimeError("Refusing to overwrite an existing excerpt")
    excerpt.save(output, garbage=4, deflate=True)
    restored = fitz.open(output)
    assert len(restored) == len(item["page_numbers"])
    renders = []
    for index, page in enumerate(item["page_numbers"]):
        before = document[page - 1].get_pixmap(dpi=96)
        after = restored[index].get_pixmap(dpi=96)
        assert before.width == after.width and before.height == after.height
        assert before.samples == after.samples, "Excerpt changed the page rendering"
        assert document[page - 1].get_text() == restored[index].get_text()
        after.save(destination / f"{item['id']}-{page}.png")
        renders.append(hashlib.sha256(after.samples).hexdigest())
    cases.append({
        "id": item["id"], "suite": item["suite"], "source_path": output.name,
        "source_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "original_sha256": item["source_sha256"],
        "original_page_numbers": item["page_numbers"],
        "page_numbers": list(range(1, len(restored) + 1)),
        "render_and_native_text_unchanged": True, "render_hashes": renders,
    })
(destination / "inputs.json").write_text(json.dumps({
    "schema_version": 1, "qualification": "authorized source excerpts; not entire documents or matrix acceptance", "cases": cases,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"excerpts": len(cases), "pages": sum(len(c["page_numbers"]) for c in cases), "render_and_native_text_unchanged": True}))
