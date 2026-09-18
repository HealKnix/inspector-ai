import hashlib
import json
import os
import re

from common import ParseError, handle_path, is_uuid, normalize
from config import digest_file, fingerprint
from pdf_parser import parse_pdf
from structured import docx_items, docx_media, render_docx_media, render_structured, xml_items


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {"schema_version", "request_id", "storage_key", "source_sha256", "format"}:
        raise ParseError("INVALID_REQUEST", status=400)
    if type(request["schema_version"]) is not int or request["schema_version"] != 1:
        raise ParseError("INVALID_SCHEMA", status=400)
    if not is_uuid(request["request_id"]) or not is_uuid(request["storage_key"]):
        raise ParseError("INVALID_REQUEST", status=400)
    if request["format"] not in ("pdf", "docx", "xml") or not isinstance(request["source_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", request["source_sha256"]):
        raise ParseError("INVALID_REQUEST", status=400)
    return request


def parse(request, settings, versions, ocr, progress):
    validate_request(request)
    original = handle_path(settings.storage / "originals", request["storage_key"])
    if not original.is_file():
        raise ParseError("SOURCE_NOT_FOUND", status=404)
    if original.stat().st_size > settings.max_bytes:
        raise ParseError("FILE_SIZE_LIMIT")
    if digest_file(original) != request["source_sha256"]:
        raise ParseError("SOURCE_HASH_MISMATCH")
    derived = settings.storage / "derived"
    derived.mkdir(parents=True, exist_ok=True)
    pipeline_hash = fingerprint(versions)
    checkpoint_root = derived / ".parser-checkpoints" / request["source_sha256"] / pipeline_hash
    checkpoint_root.mkdir(parents=True, exist_ok=True)

    def checkpoint(number, value=None):
        target = checkpoint_root / f"{number}.json"
        if value is not None:
            temporary = target.with_suffix(".tmp")
            serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            wrapped = {"page": value, "metadata_sha256": hashlib.sha256(serialized.encode()).hexdigest()}
            temporary.write_text(json.dumps(wrapped, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, target)
            return None
        if not target.is_file():
            return None
        try:
            wrapped = json.loads(target.read_text(encoding="utf-8"))
            candidate = wrapped["page"]
            if not isinstance(candidate, dict) or type(candidate.get("page_number")) is not int or candidate["page_number"] != number:
                return None
            serialized = json.dumps(candidate, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            if wrapped["metadata_sha256"] != hashlib.sha256(serialized.encode()).hexdigest():
                return None
            image = handle_path(derived, candidate["image_key"])
            if image.is_file() and digest_file(image) == candidate["image_sha256"]:
                return candidate
        except (ValueError, KeyError, TypeError, OSError, ParseError):
            pass  # A missing/corrupt local acceleration record is recomputed from immutable source.
        return None

    structured_raw = None
    if request["format"] == "pdf":
        pages = parse_pdf(original, settings, versions, ocr, progress, checkpoint)
    else:
        progress(0, None, "extracting", {"checkpoint_validated": True, "checkpoint_pages": None, "current_page": None})
        data = original.read_bytes()
        items, reasons = (docx_items if request["format"] == "docx" else xml_items)(data, settings)
        structured_raw = "\n".join(item["text"] for item in items)
        media = []
        if request["format"] == "docx":
            media, media_reasons = docx_media(data, settings)
            reasons += media_reasons
        progress(0, None, "rendering")
        pages = render_structured(items, reasons, settings, versions, progress) if not media or any(normalize(item["text"]) for item in items) else []
        if media:
            image_pages = render_docx_media(media, reasons, settings, versions, ocr, progress, len(pages))
            pages.extend(image_pages)
            structured_raw += "\n" + "\n".join(fragment["raw_text"] for page in image_pages for fragment in page["blocks"])
    if sum(len(page["blocks"]) for page in pages) > settings.max_blocks:
        raise ParseError("BLOCK_LIMIT")
    raw = structured_raw if structured_raw is not None else "\n\n".join("\n".join(item["raw_text"] for item in page["blocks"]) for page in pages)
    readable = sum(any(item["normalized_text"] for item in page["blocks"]) for page in pages)
    reasons = sorted({reason for page in pages for reason in page["reasons"]})
    artifact = {"schema_version": 1, "source_sha256": request["source_sha256"], "pipeline_fingerprint": pipeline_hash,
        "versions": versions, "raw_text": raw, "normalized_text": normalize(raw),
        "quality": "ABSTAIN" if all(page["quality"] == "ABSTAIN" for page in pages) else "LOW_QUALITY" if any(page["quality"] != "OK" for page in pages) else "OK", "reasons": reasons,
        "coverage": {"total_pages": len(pages), "readable_pages": readable, "unreadable_pages": len(pages) - readable},
        "pages": pages}
    if request["format"] == "pdf":
        artifact["region_schema_version"] = 1
    if len(json.dumps(artifact, ensure_ascii=False).encode()) > settings.max_output_bytes:
        raise ParseError("OUTPUT_SIZE_LIMIT")
    progress(len(pages), len(pages), "complete", {"current_page": None})
    return artifact
