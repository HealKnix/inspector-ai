"""Deterministic semantic source view, not a simulation of Microsoft Word pagination."""
import io
import posixpath
import zipfile
import xml.etree.ElementTree as ET

from common import ParseError, bbox_pixels, block, finalize_page, save_page

WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{" + WORD + "}"


def read_xml(data, settings):
    if len(data) > settings.max_xml_bytes:
        raise ParseError("XML_SIZE_LIMIT")
    # ElementTree does not fetch external entities, and DTD/entity declarations are rejected
    # before parsing to also rule out internal expansion and schema side effects.
    upper = data.upper().replace(b"\x00", b"")
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ParseError("XML_DTD_FORBIDDEN")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise ParseError("INVALID_XML") from error
    stack = [(root, 0)]
    count = 0
    while stack:
        node, depth = stack.pop()
        count += 1
        if depth > 128 or count > settings.max_blocks * 10:
            raise ParseError("XML_COMPLEXITY_LIMIT")
        stack.extend((child, depth + 1) for child in node)
    return root


def walk(root, path=None, ancestors=()):
    path = path or f"/{root.tag}[1]"
    yield root, path, ancestors
    counts = {}
    for child in root:
        counts[child.tag] = counts.get(child.tag, 0) + 1
        yield from walk(child, f"{path}/{child.tag}[{counts[child.tag]}]", (*ancestors, root))


def xml_items(data, settings):
    root = read_xml(data, settings)
    items = []
    def visit(node, path):
        for name, value in sorted(node.attrib.items()):
            items.append({"text": value, "path": f"{path}/@{name}", "label": f"@{name}"})
        if node.text and node.text.strip():
            items.append({"text": node.text, "path": f"{path}/text()[1]", "label": node.tag})
        if not list(node) and not node.attrib and not (node.text or "").strip():
            items.append({"text": "", "path": path, "label": node.tag + " (пустой элемент)"})
        counts = {}
        for child in node:
            counts[child.tag] = counts.get(child.tag, 0) + 1
            child_path = f"{path}/{child.tag}[{counts[child.tag]}]"
            visit(child, child_path)
            # Mixed-content tails are emitted after the entire child subtree.
            if child.tail and child.tail.strip():
                items.append({"text": child.tail, "path": f"{child_path}/following-sibling::text()[1]", "label": "текст после элемента"})
    visit(root, f"/{root.tag}[1]")
    return items, ["XML_SEMANTIC_RENDER"]


def paragraph_fragments(node, paragraph_path):
    """Keep revision alternatives and field programs distinct from displayed values."""
    fragments = []
    kinds = {W + "del": "deleted", W + "ins": "inserted", W + "moveFrom": "moved_from", W + "moveTo": "moved_to"}

    def append(text, kind, path):
        if fragments and fragments[-1]["kind"] == kind and fragments[-1]["path"] == path:
            fragments[-1]["text"] += text
        else:
            fragments.append({"text": text, "kind": kind, "path": path})

    def visit(current, current_path, kind="text", context_path=None):
        context_path = context_path or paragraph_path
        counts = {}
        for child in current:
            counts[child.tag] = counts.get(child.tag, 0) + 1
            child_path = f"{current_path}/{child.tag}[{counts[child.tag]}]"
            if child.tag == W + "p":
                continue  # A nested textbox paragraph receives its own structural locator.
            if child.tag in kinds:
                visit(child, child_path, kinds[child.tag], child_path)
            elif child.tag == W + "instrText":
                append(child.text or "", "field_instruction", child_path)
            elif child.tag == W + "delText":
                append(child.text or "", "deleted", context_path)
            elif child.tag == W + "t":
                append(child.text or "", kind, context_path)
            elif child.tag == W + "tab":
                append("\t", kind, context_path)
            elif child.tag in (W + "br", W + "cr"):
                append("\n", kind, context_path)
            else:
                if child.tag == W + "fldSimple" and child.get(W + "instr"):
                    append(child.get(W + "instr"), "field_instruction", child_path + "/@" + W + "instr")
                visit(child, child_path, kind, context_path)
    visit(node, paragraph_path)
    return fragments or [{"text": "", "kind": "text", "path": paragraph_path}]


def docx_table_metadata(root, part):
    metadata = {}
    for table_number, table in enumerate(root.iter(W + "tbl"), 1):
        active_merges = {}
        for row_number, row in enumerate(table.findall(W + "tr")):
            before = row.find(W + "trPr/" + W + "gridBefore")
            column = int(before.get(W + "val", "0")) if before is not None else 0
            next_merges = {}
            for cell in row.findall(W + "tc"):
                span_node = cell.find(W + "tcPr/" + W + "gridSpan")
                span = int(span_node.get(W + "val", "1")) if span_node is not None else 1
                if not 1 <= span <= 1000 or not 0 <= column <= 10000:
                    raise ParseError("DOCX_TABLE_LIMIT")
                merge = cell.find(W + "tcPr/" + W + "vMerge")
                info = {"table_id": f"{part}:table-{table_number}", "row": row_number,
                        "column": column, "row_span": 1, "column_span": span}
                if merge is not None:
                    previous = active_merges.get(column)
                    if merge.get(W + "val") != "restart" and previous:
                        previous["row_span"] += 1
                        info = previous
                    next_merges[column] = info
                metadata[id(cell)] = info
                column += span
            active_merges = next_merges
    return metadata


def docx_items(data, settings):
    items = []
    reasons = ["DOCX_SEMANTIC_RENDER"]
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise ParseError("INVALID_DOCX") from error
    with archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(entry.file_size for entry in entries) > settings.max_xml_bytes:
            raise ParseError("DOCX_EXPANSION_LIMIT")
        if len({entry.filename for entry in entries}) != len(entries):
            raise ParseError("DOCX_DUPLICATE_PART")
        names = {entry.filename for entry in entries}
        if "word/document.xml" not in names:
            raise ParseError("INVALID_DOCX")
        parts = ["word/document.xml"] + sorted(name for name in names if name.startswith("word/")
                  and name.endswith(".xml") and name.rsplit("/", 1)[-1].startswith(("header", "footer", "footnotes", "endnotes", "comments")))
        if any(name.startswith("word/embeddings/") for name in names):
            reasons.append("DOCX_EMBEDDED_MEDIA_UNSUPPORTED")
        for part in parts:
            root = read_xml(archive.read(part), settings)
            tables = docx_table_metadata(root, part)
            for node, path, ancestors in walk(root):
                if node.tag in (W + "altChunk", W + "object", W + "pict"):
                    reasons.append("DOCX_UNSUPPORTED_CONTENT")
                if node.tag == W + "drawing" and not any(child.tag.endswith("}blip") for child in node.iter()):
                    reasons.append("DOCX_UNSUPPORTED_CONTENT")
                if node.tag.endswith("}docPr"):
                    for name in ("title", "descr"):
                        if node.get(name):
                            items.append({"text": node.get(name), "path": f"{part}{path}/@{name}", "label": "описание изображения"})
                if node.tag != W + "p":
                    continue
                # Empty paragraphs remain mapped, including empty cells.
                cell = next((ancestor for ancestor in reversed(ancestors) if ancestor.tag == W + "tc"), None)
                metadata = tables.get(id(cell), {})
                labels = {"deleted": "удалённый текст", "inserted": "вставленный текст", "moved_from": "текст до перемещения",
                          "moved_to": "текст после перемещения", "field_instruction": "инструкция поля — не значение"}
                for fragment in paragraph_fragments(node, path):
                    kind = fragment["kind"]
                    if kind in ("deleted", "inserted", "moved_from", "moved_to"):
                        reasons.append("DOCX_TRACKED_CHANGES")
                    elif kind == "field_instruction":
                        reasons.append("DOCX_FIELD_INSTRUCTIONS")
                    label = part.rsplit("/", 1)[-1] + (" · " + labels[kind] if kind in labels else "")
                    items.append({"text": fragment["text"], "path": f"{part}{fragment['path']}", "label": label, **metadata})
        # Never resolve .rels targets, includes, linked images, schemas, macros or remote files.
    return items, sorted(set(reasons))


def docx_media(data, settings):
    """Read internal raster image relationships without extracting/following archive paths."""
    from PIL import Image, UnidentifiedImageError
    images, reasons = [], []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = set(archive.namelist())
        linked = {}
        for name in sorted(names):
            if not name.startswith("word/") or not name.endswith(".rels"):
                continue
            root = read_xml(archive.read(name), settings)
            source_part = posixpath.join(posixpath.dirname(posixpath.dirname(name)), posixpath.basename(name)[:-5])
            for rel in root:
                if not rel.get("Type", "").endswith("/image"):
                    continue
                if rel.get("TargetMode") == "External":
                    reasons.append("DOCX_EXTERNAL_MEDIA_UNAVAILABLE")
                    continue
                target = rel.get("Target", "")
                target = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(source_part), target))
                if target.startswith("../") or target not in names:
                    reasons.append("DOCX_EMBEDDED_MEDIA_UNSUPPORTED")
                    continue
                linked.setdefault(target, []).append(f"{name}#Relationship[@Id={rel.get('Id', '')}]")
        for target, references in linked.items():
            try:
                payload = archive.read(target)
                with Image.open(io.BytesIO(payload)) as image:
                    if image.format not in ("PNG", "JPEG", "BMP", "TIFF", "WEBP") or image.width * image.height > settings.max_pixels:
                        reasons.append("DOCX_EMBEDDED_MEDIA_UNSUPPORTED")
                        continue
                    if getattr(image, "n_frames", 1) > 1:
                        reasons.append("DOCX_MULTIFRAME_MEDIA_UNSUPPORTED")
                    # Keep compressed bytes; only one raster is decoded at a time.
                    images.append({"data": payload, "path": "/" + target, "relationships": references})
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
                reasons.append("DOCX_EMBEDDED_MEDIA_UNSUPPORTED")
        if any(name.startswith("word/media/") and name not in linked for name in names):
            reasons.append("DOCX_UNREFERENCED_MEDIA")
    return images, sorted(set(reasons))


def render_docx_media(media, reasons, settings, versions, ocr, progress, offset):
    from PIL import Image
    pages = []
    for index, item in enumerate(media, offset + 1):
        if index > settings.max_pages:
            raise ParseError("PAGE_LIMIT")
        progress(index - 1, offset + len(media), "ocr")
        try:
            with Image.open(io.BytesIO(item["data"])) as source:
                image = source.convert("RGB")
        except OSError as error:
            raise ParseError("INVALID_DOCX_MEDIA") from error
        blocks, rotation, detected = ocr.recognize(image)
        for fragment in blocks:
            fragment["structural_path"] = item["path"] + ("#" + fragment["structural_path"] if fragment["structural_path"] else "")
        page_reasons = reasons + ["DOCX_EMBEDDED_IMAGE_RENDER", "OCR_UNVERIFIED", "RASTER_REGIONS_REQUIRE_REVIEW"] + getattr(ocr, "reasons", [])
        if any(fragment["confidence"] is not None and fragment["confidence"] < .8 for fragment in blocks):
            page_reasons.append("OCR_LOW_CONFIDENCE")
        if getattr(ocr, "detected_without_text", detected > len(blocks)):
            page_reasons.append("OCR_DETECTION_WITHOUT_TEXT")
        if getattr(ocr, "orientation_ambiguous", False):
            page_reasons.append("OCR_ORIENTATION_AMBIGUOUS")
        readable = any(fragment["normalized_text"] for fragment in blocks)
        if not readable:
            page_reasons.append("NO_READABLE_TEXT")
        key, sha = save_page(image, settings.storage / "derived")
        pages.append(finalize_page({"page_number": index, "sheet_label": None,
            "width": image.width, "height": image.height, "image_key": key, "image_sha256": sha,
            "quality": "LOW_QUALITY" if readable else "ABSTAIN", "reasons": page_reasons, "blocks": blocks,
            "transform": {"renderer": versions["renderer"], "coordinate_space": "visible-page-normalized",
                          "structural_mapping": True, "font_sha256": versions["font_sha256"], "layout": "embedded-media-v1",
                          "render_width": image.width, "render_height": image.height, "media_part": item["path"],
                          "media_relationships": item["relationships"], "ocr_regions": [{"bbox": [0, 0, 1, 1], "rotation": rotation,
                              "orientation_model_score": getattr(ocr, "orientation_score", None), "detected_regions": detected}]}}))
        progress(index, offset + len(media), "rendering")
    return pages


def wrap_text(text, font, width):
    # Character-based hard wrapping preserves long identifiers and every original character.
    lines = []
    current, raw = "", ""
    for char in text:
        if char in "\r\n":
            lines.append((current, raw + char))
            current, raw = "", ""
            continue
        visible = "    " if char == "\t" else char
        if current and font.getlength(current + visible) > width:
            lines.append((current, raw))
            current, raw = "", ""
        current += visible
        raw += char
    if current or raw or not lines:
        lines.append((current, raw))
    return lines


def render_structured(items, reasons, settings, versions, progress):
    from PIL import Image, ImageDraw, ImageFont
    if len(items) > settings.max_blocks:
        raise ParseError("BLOCK_LIMIT")
    width, height, margin, line_height = 1240, 1754, 60, 27
    if width * height > settings.max_pixels:
        raise ParseError("RENDER_PIXEL_LIMIT")
    font = ImageFont.truetype(str(settings.font), 19)
    small = ImageFont.truetype(str(settings.font), 14)
    pages = []
    page_items = []
    y = 100
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    def complete():
        nonlocal image, draw, page_items, y
        if len(pages) >= settings.max_pages:
            raise ParseError("PAGE_LIMIT")
        draw.text((margin, 30), "Представление содержимого · структурные пути исходного документа", font=small, fill="#546273")
        key, sha = save_page(image, settings.storage / "derived")
        readable = any(part["normalized_text"] for part in page_items)
        pages.append(finalize_page({"page_number": len(pages) + 1, "sheet_label": None,
            "width": width, "height": height, "image_key": key, "image_sha256": sha,
            "quality": ("LOW_QUALITY" if any(reason not in ("DOCX_SEMANTIC_RENDER", "XML_SEMANTIC_RENDER") for reason in reasons) else "OK") if readable else "ABSTAIN",
            "reasons": reasons + ([] if readable else ["NO_READABLE_TEXT"]),
            "transform": {"renderer": versions["renderer"], "coordinate_space": "visible-page-normalized",
                          "structural_mapping": True, "render_width": width, "render_height": height,
                          "font_sha256": versions["font_sha256"], "layout": "semantic-structure-v1"},
            "blocks": page_items}))
        progress(len(pages), None, "rendering")
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        page_items, y = [], 100

    for item in items:
        lines = wrap_text(item["text"], font, width - 2 * margin - 20)
        offset = 0
        while offset < len(lines):
            if y + 70 > height - margin:
                complete()
            available = max(1, (height - margin - y - 32) // line_height)
            segment = lines[offset:offset + available]
            top = y
            label = item["label"]
            if item.get("table_id"):
                label += f' · таблица · строка {item["row"] + 1}, столбец {item["column"] + 1}'
            draw.text((margin + 8, y), label[:140], font=small, fill="#53677a")
            y += 25
            for line, _ in segment:
                draw.text((margin + 8, y), line, font=font, fill="#172532")
                y += line_height
            draw.rectangle((margin, top - 3, width - margin, y + 2), outline="#cbd5df", width=1)
            # Each locator contains exactly the source characters drawn in its fragment.
            text = "".join(raw for _, raw in segment)
            part = block(text, bbox_pixels((margin, top, width - margin, y), width, height), "structured", item["path"],
                         **{key: item[key] for key in ("table_id", "row", "column", "row_span", "column_span") if key in item})
            page_items.append(part)
            y += 18
            offset += len(segment)
    if page_items or not pages:
        complete()
    progress(len(pages), None, "rendering")
    return pages
