"""Find image-only pages in the permitted public train object, never hidden.

Outputs are local inspection material, excluded by .gitignore. This does not
read public/hidden annotations or change the object split.
"""

import hashlib
import json
from pathlib import Path

import pypdfium2 as pdfium

REPO = Path(__file__).resolve().parents[2]
PACKAGE = REPO.parent / "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ"
DOCS = PACKAGE / "01_ДОКУМЕНТАЦИЯ"
MANIFEST = PACKAGE / "02_ФОРМАТ_ДАННЫХ_И_ПРИМЕРЫ/data/document_manifest.jsonl"
OUT = Path(__file__).resolve().parent / ".local"


def main():
    expected = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
    assert hashlib.sha256(MANIFEST.read_bytes()).hexdigest() == expected
    rows = [json.loads(line) for line in MANIFEST.read_text(encoding="utf-8").splitlines() if line]
    permitted = [r for r in rows if r["split"] == "TRAIN_PUBLIC" and r["object_id"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED"]
    OUT.mkdir(exist_ok=True)
    found = []
    for row in permitted:
        if Path(row["relative_path"]).suffix.lower() != ".pdf":
            continue
        path = (DOCS / row["relative_path"]).resolve()
        assert path.is_relative_to(DOCS.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
        doc = pdfium.PdfDocument(path)
        for page_index in range(min(10, len(doc))):
            page = doc[page_index]
            textpage = page.get_textpage()
            chars = textpage.count_chars()
            textpage.close()
            image_count = sum(1 for _ in page.get_objects(filter=[3]))
            if chars == 0 and image_count:
                name = f'{row["file_id"]}-p{page_index + 1}.png'
                page.render(scale=min(2, 1700 / page.get_width())).to_pil().save(OUT / name)
                found.append({**row, "page": page_index + 1, "native_characters": chars, "image_objects": image_count, "preview": name})
                if len(found) >= 5:
                    break
            page.close()
        doc.close()
        if len(found) >= 5:
            break
    (OUT / "raster-candidates.json").write_text(json.dumps(found, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps([{k: r[k] for k in ("file_id", "object_id", "page", "native_characters", "image_objects", "preview")} for r in found], ensure_ascii=False))


if __name__ == "__main__":
    main()
