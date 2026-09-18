"""Adaptive PDF extraction: original render → layout → native/selected OCR."""
import math

from common import ParseError, bbox_pixels, block, finalize_page, save_page
from pdf_regions import (attach_native, layout_regions, native_table_cells, overlap,
                         residual_regions, uncovered_lines, valid_native)


def render_region(page, region, settings):
    """Render this crop directly from the PDF at the configured DPI once."""
    import pymupdf
    from PIL import Image
    width, height = page.rect.width, page.rect.height
    a, b, c, d = region["bbox"]
    rect = pymupdf.Rect(a * width, b * height, c * width, d * height)
    scale = min(settings.render_dpi / 72, math.sqrt(settings.max_pixels / max(1., rect.get_area())))
    if scale < settings.render_dpi / 72:
        region["reasons"].append("RENDER_RESOLUTION_LIMITED")
    raster = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=rect, alpha=False, colorspace=pymupdf.csRGB)
    image = Image.frombytes("RGB", (raster.width, raster.height), raster.samples)
    # Integer device origin gives the exact translation even with CropBox+Rotate.
    box = bbox_pixels([raster.x / scale, raster.y / scale,
                       (raster.x + raster.width) / scale, (raster.y + raster.height) / scale], width, height)
    return image, box


def local_native(native, crop_box):
    a, b, c, d = crop_box
    return [{**item, "bbox": [(item["bbox"][0] - a) / (c - a), (item["bbox"][1] - b) / (d - b),
                              (item["bbox"][2] - a) / (c - a), (item["bbox"][3] - b) / (d - b)]} for item in native]


def map_to_page(item, crop_box, owner):
    a, b, c, d = crop_box
    x0, y0, x1, y1 = item["bbox"]
    item["bbox"] = [max(0., min(1., value)) for value in
                    (a + x0 * (c - a), b + y0 * (d - b), a + x1 * (c - a), b + y1 * (d - b))]
    item.update(region_id=owner["id"], include_in_main=True)
    if item["table_id"]:
        item["table_id"] = f'{owner["id"]}-{item["table_id"]}'
    return item


def process_region(page, owner, blocks, settings, ocr, progress, excluded):
    if owner["kind"] in ("graphic", "unknown"):
        return
    native = [item for item in blocks if item.get("region_id") == owner["id"] and item["source"] == "native"]
    usable = [item for item in native if item["_native_valid"]]
    if len(usable) != len(native):
        owner["reasons"].append("NATIVE_TEXT_ENCODING")
    crop, crop_box = render_region(page, owner, settings)
    local = local_native(usable, crop_box)
    polygons = ocr.detect_lines(crop)
    allowed = []
    for polygon in polygons:
        xs, ys = zip(*polygon)
        line_box = bbox_pixels([min(xs), min(ys), max(xs), max(ys)], crop.width, crop.height)
        located = map_to_page(block("", line_box, "ocr"), crop_box, owner)["bbox"]
        if any(overlap(located, box) > 0 for box in excluded):
            owner["reasons"].append("OCR_LINE_CROSSES_EXCLUDED_REGION")
        else:
            allowed.append(polygon)
    polygons = allowed
    missing = uncovered_lines(polygons, local, crop.size, crop)
    recognized = []
    if missing:
        progress("ocr")
        recognized = ocr.recognize_lines(crop, missing)
        owner["reasons"].append("OCR_UNVERIFIED")
        if len(recognized) < len(missing):
            owner["reasons"].append("OCR_DETECTION_WITHOUT_TEXT")
        if any(item["confidence"] is not None and item["confidence"] < .8 for item in recognized):
            owner["reasons"].append("OCR_LOW_CONFIDENCE")
    elif not polygons and not usable:
        owner["reasons"].append("NO_DETECTED_TEXT")
    if owner["kind"] == "text":
        owner["method"] = "hybrid" if missing and usable else "ocr" if missing or not usable else "native"
        blocks.extend(map_to_page(item, crop_box, owner) for item in recognized)
        return
    cells = []
    if usable and not missing:
        owner["method"] = "native_table"
        cells = native_table_cells(page, owner, usable, page.number + 1)
        for item in cells:
            item.update(region_id=owner["id"], include_in_main=True)
    else:
        owner["method"] = "hybrid" if usable else "table_ocr"
        if local or recognized:
            progress("ocr")
            candidates, table_reasons = ocr.structure_region(crop, local + recognized)
            cells = [map_to_page(item, crop_box, owner) for item in candidates if item["kind"] == "table_cell"]
            owner["reasons"].extend(reason for reason in table_reasons if reason != "OCR_TABLE_TEXT_DIFFERENCE")
            blocks.extend(map_to_page(item, crop_box, owner) for item in candidates if item["kind"] != "table_cell")
        blocks.extend(map_to_page(item, crop_box, owner) for item in recognized)
    if cells:
        owner["table_status"] = "structured"
        owner["reasons"].append("TABLE_STRUCTURE_UNVERIFIED")
        for item in native:
            if any(overlap(item["bbox"], cell["bbox"]) >= .5 and item["raw_text"] in cell["raw_text"] for cell in cells):
                item["include_in_main"] = False
        blocks.extend(cells)
    else:
        owner["table_status"] = "unconfirmed" if usable or recognized else "unreadable"
        owner["reasons"].append("TABLE_STRUCTURE_UNAVAILABLE")


def parse_pdf(path, settings, versions, ocr, progress, checkpoint=None):
    import pymupdf
    from PIL import Image
    try:
        document = pymupdf.open(path)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError, RuntimeError) as error:
        raise ParseError("INVALID_PDF") from error
    pages = []
    with document:
        if document.needs_pass:
            raise ParseError("PDF_ENCRYPTED")
        if document.page_count > settings.max_pages:
            raise ParseError("PAGE_LIMIT")
        progress(0, document.page_count, "checkpoint_verifying", {"checkpoint_validated": False,
                 "checkpoint_pages": None, "current_page": None})
        cached_pages = {}
        if checkpoint:
            for number in range(1, document.page_count + 1):
                cached = checkpoint(number)
                if cached and "regions" in cached and all("region_id" in item and "include_in_main" in item for item in cached["blocks"]):
                    cached_pages[number] = cached
        completed = len(cached_pages)
        progress(completed, document.page_count, "resuming" if completed else "extracting",
                 {"checkpoint_validated": True, "checkpoint_pages": completed, "current_page": None})
        for number, page in enumerate(document, 1):
            if number in cached_pages:
                pages.append(cached_pages.pop(number))
                continue
            stage = lambda name: progress(completed, document.page_count, name, {"current_page": number})
            stage("rendering")
            reasons = []
            width, height = page.rect.width, page.rect.height
            if width <= 0 or height <= 0 or not math.isfinite(width * height):
                raise ParseError("INVALID_PAGE_GEOMETRY")
            scale = min(settings.render_dpi / 72, math.sqrt(settings.max_pixels / (width * height)))
            if scale < settings.render_dpi / 72:
                reasons.append("RENDER_RESOLUTION_LIMITED")
            raster = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, colorspace=pymupdf.csRGB)
            if raster.width * raster.height > settings.max_pixels + raster.width + raster.height:
                raise ParseError("RENDER_PIXEL_LIMIT")
            image = Image.frombytes("RGB", (raster.width, raster.height), raster.samples)
            stage("layout")
            regions = layout_regions(ocr.layout(image), image, number)
            stage("extracting")
            blocks = []
            flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
            native_data = page.get_text("dict", flags=flags)["blocks"]
            strict_data = page.get_text("dict", flags=flags & ~getattr(pymupdf, "TEXT_CID_FOR_UNKNOWN_UNICODE", 0))["blocks"]
            # Audit text keeps the previous extractor's exact characters,
            # including CID fallbacks. The strict reading is only a suitability
            # check: replacing audit characters with U+FFFD would lose data.
            # Match traversal positions AND geometry; never zip/truncate or
            # silently attach a neighbouring line's validation result.
            strict_lines = {(bi, li): line for bi, native in enumerate(strict_data)
                            for li, line in enumerate(native.get("lines", []))}
            for block_index, native in enumerate(native_data):
                for line_index, line in enumerate(native.get("lines", [])):
                    text = "".join(span["text"] for span in line["spans"])
                    if not text.strip():
                        continue
                    rect = pymupdf.Rect(line["bbox"]) * page.rotation_matrix
                    rect &= page.rect
                    if rect.is_empty:
                        continue
                    item = block(text, bbox_pixels(rect, width, height), "native")
                    strict = strict_lines.get((block_index, line_index))
                    strict_text = "".join(span["text"] for span in strict["spans"]) if strict else None
                    item["_native_valid"] = (strict is not None and strict["bbox"] == line["bbox"]
                                             and strict.get("dir") == line.get("dir") and strict_text == text
                                             and valid_native(strict_text, strict.get("dir", []), strict["bbox"]))
                    blocks.append(item)
            attach_native(blocks, regions, number)
            residual_regions(image, regions, number)
            excluded = [owner["bbox"] for owner in regions if owner["kind"] in ("graphic", "unknown")]
            for owner in regions:
                process_region(page, owner, blocks, settings, ocr, stage, excluded)
                owner["reasons"] = sorted(set(owner["reasons"]))
                if owner["kind"] in ("text", "table"):
                    reasons.extend(owner["reasons"])
            if any(owner["kind"] == "unknown" for owner in regions):
                reasons.append("LAYOUT_REGIONS_UNCERTAIN")
            blocks = [item for item in blocks if item["kind"] == "table_cell" or item["normalized_text"]]
            for item in blocks:
                item.pop("_native_valid", None)
            if len(blocks) > settings.max_blocks:
                raise ParseError("BLOCK_LIMIT")
            readable = any(item["normalized_text"] for item in blocks)
            planned_graphic = bool(regions) and all(owner["kind"] == "graphic" for owner in regions)
            if not readable and not planned_graphic:
                reasons.append("NO_READABLE_TEXT")
            key, sha = save_page(image, settings.storage / "derived")
            rotation, native_rotation = page.rotation, page.rotation_matrix
            try:
                page.set_rotation(0)
                pdf_to_native = page.transformation_matrix
            finally:
                page.set_rotation(rotation)
            transform = pdf_to_native * native_rotation
            normalized_transform = transform * pymupdf.Matrix(1 / width, 1 / height)
            result = finalize_page({"page_number": number, "sheet_label": page.get_label() or None,
                "width": image.width, "height": image.height, "image_key": key, "image_sha256": sha,
                "quality": ("LOW_QUALITY" if reasons else "OK") if readable or planned_graphic else "ABSTAIN",
                "reasons": reasons, "blocks": blocks, "regions": regions,
                "transform": {"renderer": versions["renderer"], "coordinate_space": "visible-page-normalized",
                    "media_box": list(page.mediabox), "crop_box": list(page.cropbox), "rotation": page.rotation,
                    "visible_width_points": width, "visible_height_points": height,
                    "pdf_to_visible": list(transform), "visible_to_pdf": list(~transform),
                    "matrix_coordinate_space": "visible-page-points",
                    "pdf_to_normalized": list(normalized_transform), "normalized_to_pdf": list(~normalized_transform),
                    "native_to_visible": list(page.rotation_matrix), "visible_to_native": list(page.derotation_matrix),
                    "render_width": image.width, "render_height": image.height,
                    "ocr_regions": [{"bbox": owner["bbox"], "region_id": owner["id"], "rotation": 0}
                                    for owner in regions if owner["method"] in ("ocr", "table_ocr", "hybrid")],
                    "unprocessed_regions": [{"bbox": owner["bbox"], "reason": "GRAPHIC_PRESERVED" if owner["kind"] == "graphic" else "LAYOUT_REGIONS_UNCERTAIN"}
                                            for owner in regions if owner["kind"] in ("graphic", "unknown")]}})
            pages.append(result)
            if checkpoint:
                checkpoint(number, result)
            completed += 1
            progress(completed, document.page_count, "extracting", {"current_page": number})
    return pages
