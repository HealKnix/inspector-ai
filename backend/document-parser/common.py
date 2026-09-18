import hashlib
import os
import re
import unicodedata
import uuid
from pathlib import Path


class ParseError(Exception):
    def __init__(self, code, retryable=False, status=422):
        self.code, self.retryable, self.status = code, retryable, status
        super().__init__(code)


def normalize(text):
    # Keep line boundaries, case, punctuation, signs and letters; never fix OCR guesses.
    return "\n".join(re.sub(r"[^\S\r\n]+", " ", line).strip()
                     for line in unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()


def is_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value.lower()
    except (ValueError, TypeError, AttributeError):
        return False


def handle_path(directory, key):
    if not is_uuid(key):
        raise ParseError("INVALID_STORAGE_HANDLE", status=400)
    root = Path(directory).resolve()
    path = root / key
    if path.is_symlink() or path.resolve().parent != root:
        raise ParseError("INVALID_STORAGE_HANDLE", status=400)
    return path


def block(text, bbox, source, structural_path=None, **table):
    return {"id": "", "order": 0, "kind": "table_cell" if table.get("table_id") else "text",
            "raw_text": text, "normalized_text": normalize(text), "bbox": [round(float(x), 7) for x in bbox],
            "confidence": None, "source": source, "structural_path": structural_path,
            "table_id": None, "row": None, "column": None, "row_span": None, "column_span": None, **table}


def bbox_pixels(box, width, height):
    return [max(0.0, min(1.0, box[0] / width)), max(0.0, min(1.0, box[1] / height)),
            max(0.0, min(1.0, box[2] / width)), max(0.0, min(1.0, box[3] / height))]


def save_page(image, directory):
    from io import BytesIO
    data = BytesIO()
    image.save(data, "PNG", optimize=False)
    payload = data.getvalue()
    key = str(uuid.uuid4())
    with handle_path(directory, key).open("xb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    if os.name != "nt":
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    return key, hashlib.sha256(payload).hexdigest()


def finalize_page(page):
    tables = {}
    for index, item in enumerate(page["blocks"]):
        item["order"] = index
        item["id"] = f'p{page["page_number"]}-b{index + 1}'
        if item["table_id"]:
            # DOCX paragraphs and page continuations may share a source cell.
            # Rendered fragments remain independently addressable without
            # overlapping logical grid positions inside a displayed table.
            source_id = item["table_id"]
            if source_id not in tables:
                tables[source_id] = (len(tables) + 1, [])
            table_number, groups = tables[source_id]
            rect = (item["row"], item["column"], item["row"] + item["row_span"], item["column"] + item["column_span"])
            for group_number, occupied in enumerate(groups):
                if not any(rect[0] < other[2] and other[0] < rect[2] and rect[1] < other[3] and other[1] < rect[3] for other in occupied):
                    break
            else:
                group_number = len(groups)
                groups.append([])
            groups[group_number].append(rect)
            item["table_id"] = f'p{page["page_number"]}-t{table_number}-part{group_number + 1}'
    page["reasons"] = sorted(set(page["reasons"]))
    return page
