import math

from common import ParseError, bbox_pixels, block, finalize_page, save_page
from tables import structure_tables


def overlap(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = max(1e-12, (a[2] - a[0]) * (a[3] - a[1]))
    return intersection / area


def merge_regions(regions):
    merged = []
    for candidate in regions:
        for index, previous in enumerate(merged):
            if overlap(candidate, previous) > 0 or overlap(previous, candidate) > 0:
                merged[index] = [min(candidate[0], previous[0]), min(candidate[1], previous[1]),
                                 max(candidate[2], previous[2]), max(candidate[3], previous[3])]
                break
        else:
            merged.append(candidate)
    return merged


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
        progress(0, document.page_count, "extracting")
        for number, page in enumerate(document, 1):
            if checkpoint:
                cached = checkpoint(number)
                if cached:
                    pages.append(cached)
                    progress(number, document.page_count, "resuming")
                    continue
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
            blocks = []
            flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
            for native in page.get_text("dict", flags=flags)["blocks"]:
                for line in native.get("lines", []):
                    text = "".join(span["text"] for span in line["spans"])
                    if not text.strip():
                        continue
                    rect = pymupdf.Rect(line["bbox"]) * page.rotation_matrix
                    rect &= page.rect
                    if rect.is_empty:
                        continue
                    item = block(text, bbox_pixels(rect, width, height), "native")
                    blocks.append(item)
            if any("\ufffd" in item["raw_text"] for item in blocks):
                reasons.append("NATIVE_TEXT_ENCODING")
            regions = []
            unprocessed_regions = []
            for info in page.get_image_info():
                rect = pymupdf.Rect(info["bbox"]) * page.rotation_matrix
                rect &= page.rect
                if not rect.is_empty and rect.get_area() / (width * height) >= .002:
                    regions.append(bbox_pixels(rect, width, height))
                elif not rect.is_empty:
                    unprocessed_regions.append({"bbox": bbox_pixels(rect, width, height), "reason": "RASTER_SMALL_REGION_UNREADABLE"})
            if not blocks or "NATIVE_TEXT_ENCODING" in reasons:
                regions = [[0, 0, 1, 1]]
                unprocessed_regions = []
            # CAD/exported text may be outlines rather than image objects. A
            # native header must not hide those areas. One masked whole-page
            # fallback bounds the work regardless of the number of paths.
            uncovered_vectors = 0
            if blocks:
                for drawing in page.get_drawings():
                    rect = pymupdf.Rect(drawing["rect"]) * page.rotation_matrix
                    rect &= page.rect
                    if rect.is_empty or rect.get_area() <= 0:
                        continue
                    colors = [color for color in (drawing.get("fill"), drawing.get("color")) if color is not None]
                    if colors and all(all(channel > .95 for channel in color) for color in colors):
                        continue
                    candidate = bbox_pixels(rect, width, height)
                    if not any(overlap(candidate, native["bbox"]) >= .95 for native in blocks):
                        uncovered_vectors += 1
                if uncovered_vectors:
                    reasons.append("VECTOR_REGIONS_REQUIRE_REVIEW")
                    regions, unprocessed_regions = [[0, 0, 1, 1]], []
            if unprocessed_regions:
                reasons.append("RASTER_SMALL_REGION_UNREADABLE")
            regions = merge_regions(regions)
            ocr_regions = []
            # A broken native text layer is retained for audit, but cannot suppress OCR.
            native_blocks = [item for item in blocks if "\ufffd" not in item["raw_text"]]
            for region in regions:
                x0, y0 = int(region[0] * image.width), int(region[1] * image.height)
                x1, y1 = min(image.width, math.ceil(region[2] * image.width)), min(image.height, math.ceil(region[3] * image.height))
                if x1 <= x0 or y1 <= y0:
                    continue
                progress(number - 1, document.page_count, "ocr")
                crop = image.crop((x0, y0, x1, y1))
                # Mask legible native text in this image region so a scanned attachment
                # receives OCR without re-recognizing an entire searchable text layer.
                from PIL import ImageDraw
                mask = ImageDraw.Draw(crop)
                for native in native_blocks:
                    a, b, c, d = native["bbox"]
                    mask.rectangle((a * image.width - x0 - 2, b * image.height - y0 - 2,
                                    c * image.width - x0 + 2, d * image.height - y0 + 2), fill="white")
                import numpy as np
                pixels = np.array(crop.convert("L"))
                if (pixels < 180).mean() < .0002:
                    continue
                recognized, rotation, detected = ocr.recognize(crop)
                ocr_regions.append({"bbox": region, "rotation": rotation, "detected_regions": detected,
                                    "orientation_model_score": getattr(ocr, "orientation_score", None)})
                reasons.extend(["OCR_UNVERIFIED", "RASTER_REGIONS_REQUIRE_REVIEW", "BORDERLESS_TABLES_UNSUPPORTED"])
                if getattr(ocr, "orientation_ambiguous", False):
                    reasons.append("OCR_ORIENTATION_AMBIGUOUS")
                if detected > len(recognized):
                    reasons.append("OCR_DETECTION_WITHOUT_TEXT")
                for item in recognized:
                    a, b, c, d = item["bbox"]
                    item["bbox"] = bbox_pixels((x0 + a * crop.width, y0 + b * crop.height,
                                                x0 + c * crop.width, y0 + d * crop.height), image.width, image.height)
                    # Preserve native text when both methods saw the same location.
                    if any(overlap(item["bbox"], native["bbox"]) >= .65 for native in native_blocks):
                        continue
                    if item["confidence"] < .8:
                        reasons.append("OCR_LOW_CONFIDENCE")
                    blocks.append(item)
            if len(blocks) > settings.max_blocks:
                raise ParseError("BLOCK_LIMIT")
            blocks, found_tables = structure_tables(blocks, image, number)
            if found_tables:
                reasons.append("TABLE_GEOMETRY_UNVERIFIED")
            readable = any(item["normalized_text"] for item in blocks)
            if not readable:
                reasons.append("NO_READABLE_TEXT")
            key, sha = save_page(image, settings.storage / "derived")
            # PyMuPDF 1.27's transformation_matrix loses the CropBox translation
            # while /Rotate is nonzero. Read the PDF→native matrix with rotation
            # temporarily cleared, then compose the exact original rotation.
            rotation = page.rotation
            native_rotation = page.rotation_matrix
            try:
                page.set_rotation(0)
                pdf_to_native = page.transformation_matrix
            finally:
                page.set_rotation(rotation)
            transform = pdf_to_native * native_rotation
            normalized_transform = transform * pymupdf.Matrix(1 / width, 1 / height)
            result = finalize_page({"page_number": number, "sheet_label": page.get_label() or None,
                "width": image.width, "height": image.height, "image_key": key, "image_sha256": sha,
                "quality": ("LOW_QUALITY" if reasons else "OK") if readable else "ABSTAIN",
                "reasons": reasons, "blocks": blocks,
                "transform": {"renderer": versions["renderer"], "coordinate_space": "visible-page-normalized",
                    "media_box": list(page.mediabox), "crop_box": list(page.cropbox), "rotation": page.rotation,
                    "visible_width_points": width, "visible_height_points": height,
                    "pdf_to_visible": list(transform), "visible_to_pdf": list(~transform),
                    "matrix_coordinate_space": "visible-page-points",
                    "pdf_to_normalized": list(normalized_transform), "normalized_to_pdf": list(~normalized_transform),
                    "native_to_visible": list(page.rotation_matrix), "visible_to_native": list(page.derotation_matrix),
                    "render_width": image.width, "render_height": image.height, "ocr_regions": ocr_regions,
                    "unprocessed_regions": unprocessed_regions, "uncovered_vector_paths": uncovered_vectors}})
            pages.append(result)
            if checkpoint:
                checkpoint(number, result)
            progress(number, document.page_count, "extracting")
    return pages
