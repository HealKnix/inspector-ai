"""Region policy and geometry, independent of the Paddle model implementation.

Unknown means retained for inspection, never permission to run OCR. The policy
is deliberately conservative because this layout model is not a CAD classifier.
"""
import math
import unicodedata

from common import ParseError, bbox_pixels, block
from config import REGION_OPTIONS
from pp_structure import area, intersection, rectangle, valid_geometry

TEXT_LABELS = {"text", "paragraph_title", "number", "abstract", "content", "figure_title",
               "reference", "doc_title", "footnote", "header", "footer", "aside_text", "reference_content"}
GRAPHIC_LABELS = {"image", "chart", "seal", "header_image", "footer_image"}


def overlap(a, b):
    return intersection(a, b) / max(1e-12, area(a))


def region(box, kind, label=None, score=None, reasons=None):
    return {"id": "", "kind": kind, "bbox": list(box), "raw_class": label, "raw_score": score,
            "method": "skipped" if kind in ("graphic", "unknown") else "native_table" if kind == "table" else "native",
            "reasons": reasons or [], "table_status": "unconfirmed" if kind == "table" else "not_applicable"}


def layout_regions(predictions, image, number):
    result = []
    for prediction in predictions:
        box = rectangle(prediction.get("coordinate", []), image.width, image.height)
        if box is None:
            # An unlocatable prediction cannot license recognition anywhere.
            continue
        label = str(prediction.get("label", "unknown"))
        score = float(prediction.get("score", 0))
        score = max(0., min(1., score)) if math.isfinite(score) else 0.
        kind = "text" if label in TEXT_LABELS else "graphic" if label in GRAPHIC_LABELS else "table" if label == "table" else "unknown"
        reasons = ["GRAPHIC_PRESERVED"] if kind == "graphic" else []
        if kind == "unknown":
            reasons.append("LAYOUT_UNSUPPORTED_CLASS")
        if score < REGION_OPTIONS["layout_min_score"]:
            kind = "unknown"
            reasons.append("LAYOUT_LOW_CONFIDENCE")
        result.append(region(bbox_pixels(box, image.width, image.height), kind, label, score, reasons))
    # Evaluate the original classifications before changing any of them. All
    # members of a conflict are retained separately and explicitly abstain.
    conflicts = set()
    for i, left in enumerate(result):
        for j in range(i + 1, len(result)):
            right = result[j]
            shared = intersection(left["bbox"], right["bbox"])
            if shared / min(area(left["bbox"]), area(right["bbox"])) > REGION_OPTIONS["conflict_overlap"]:
                # Duplicate text regions also have ambiguous ownership; neither
                # should cause the same pixels to be recognized twice.
                conflicts.update((i, j))
    for i in conflicts:
        result[i].update(kind="unknown", method="skipped", table_status="not_applicable")
        result[i]["reasons"].append("LAYOUT_BOUNDARY_CONFLICT")
    assign_ids(result, number)
    return result


def assign_ids(regions, number):
    if len(regions) > 10000:
        raise ParseError("REGION_LIMIT")
    for index, item in enumerate(regions, 1):
        item["id"] = f"p{number}-r{index}"


def valid_native(text, direction, box):
    if not text.strip() or any(unicodedata.category(char) in ("Cc", "Cs", "Co", "Cn") and char not in "\t\n\r" for char in text):
        return False
    if "\ufffd" in text or not all(math.isfinite(float(x)) for x in box) or area(box) <= 0:
        return False
    return len(direction) == 2 and all(math.isfinite(float(x)) for x in direction) and abs(math.hypot(*direction) - 1) < .02


def attach_native(blocks, regions, number):
    for item in blocks:
        matches = [r for r in regions if overlap(item["bbox"], r["bbox"]) >= .65]
        if matches:
            # Explicit abstention wins at conflicting boundaries. Native text
            # itself is never removed, including fragments crossing regions.
            owner = min(matches, key=lambda r: (r["kind"] not in ("unknown", "graphic"), -overlap(item["bbox"], r["bbox"]), area(r["bbox"])))
        else:
            owner = region(item["bbox"], "unknown", reasons=["NATIVE_OUTSIDE_LAYOUT"])
            regions.append(owner)
            owner["id"] = f"p{number}-r{len(regions)}"
        item["region_id"] = owner["id"]
        item["include_in_main"] = owner["kind"] in ("text", "table") and item.get("_native_valid", True)


def residual_regions(image, regions, number):
    """Retain unclassified ink without a second model or whole-page OCR.

    Morphology groups nearby residual pixels only for an inspection locator.
    It does not assign a semantic class, and never changes a layout boundary.
    """
    import cv2
    import numpy as np
    factor = min(1., 1200 / max(image.size))
    size = (max(1, round(image.width * factor)), max(1, round(image.height * factor)))
    pixels = np.asarray(image.convert("L").resize(size))
    ink = (pixels < 210).astype(np.uint8)
    h, w = ink.shape
    for item in regions:
        a, b, c, d = item["bbox"]
        ink[max(0, int(b * h) - 1):min(h, math.ceil(d * h) + 1), max(0, int(a * w) - 1):min(w, math.ceil(c * w) + 1)] = 0
    if not ink.any():
        return
    grouped = cv2.dilate(ink, np.ones((9, 9), np.uint8))
    count, _labels, stats, _centres = cv2.connectedComponentsWithStats(grouped)
    boxes = []
    for x, y, width, height, _size in stats[1:count]:
        if int(ink[y:y + height, x:x + width].sum()) >= 3:
            boxes.append([int(x), int(y), int(x + width), int(y + height)])
    # A pathological drawing cannot create unbounded UI metadata. The remainder
    # stays visible as one explicitly coarse unknown locator, never discarded.
    if len(boxes) > 256:
        remaining = boxes[255:]
        boxes = boxes[:255] + [[min(b[0] for b in remaining), min(b[1] for b in remaining),
                               max(b[2] for b in remaining), max(b[3] for b in remaining)]]
    # A frame can connect around a paragraph: its component's enclosing box is
    # not an unknown rectangle over that paragraph. Subtract every occupied
    # rectangle so the bbox-only contract never misrepresents that hole.
    occupied = [[max(0, int(r["bbox"][0] * w) - 1), max(0, int(r["bbox"][1] * h) - 1),
                 min(w, math.ceil(r["bbox"][2] * w) + 1), min(h, math.ceil(r["bbox"][3] * h) + 1)] for r in regions]
    pieces = boxes
    for occupied_box in occupied:
        pieces = [piece for box in pieces for piece in subtract_box(box, occupied_box)]
        if len(pieces) > 10000:
            raise ParseError("REGION_LIMIT")
    for box in sorted(pieces, key=lambda b: (b[1], b[0])):
        x0, y0, x1, y1 = map(int, box)
        if int(ink[y0:y1, x0:x1].sum()) >= 3:
            regions.append(region(bbox_pixels(box, w, h), "unknown", reasons=["CONTENT_OUTSIDE_LAYOUT"]))
    assign_ids(regions, number)


def subtract_box(box, excluded):
    a, b, c, d = box
    x0, y0, x1, y1 = max(a, excluded[0]), max(b, excluded[1]), min(c, excluded[2]), min(d, excluded[3])
    if x0 >= x1 or y0 >= y1:
        return [box]
    return [r for r in ([a, b, c, y0], [a, y1, c, d], [a, y0, x0, y1], [x1, y0, c, y1])
            if r[0] < r[2] and r[1] < r[3]]


def coverage(rect, boxes):
    """Exact union area; overlapping native rectangles never double-count."""
    clipped = [[max(rect[0], b[0]), max(rect[1], b[1]), min(rect[2], b[2]), min(rect[3], b[3])] for b in boxes]
    clipped = [b for b in clipped if b[0] < b[2] and b[1] < b[3]]
    xs = sorted({x for b in clipped for x in (b[0], b[2])})
    total = 0.
    for a, b in zip(xs, xs[1:]):
        segments = sorted((r[1], r[3]) for r in clipped if r[0] < b and r[2] > a)
        extent, end = 0., -math.inf
        for start, stop in segments:
            extent += max(0., stop - max(start, end))
            end = max(end, stop)
        total += (b - a) * extent
    return total / max(1e-12, area(rect))


def ink_coverage(polygon, boxes, image):
    """Fraction of actual foreground covered by valid native rectangles.

    Detector padding is not missing text. Count the original dark pixels in
    the detected polygon, excluding long straight rules, rather than its white
    margin. Empty evidence never certifies coverage.
    """
    import cv2
    import numpy as np
    xs, ys = zip(*polygon)
    left, top = max(0, math.floor(min(xs))), max(0, math.floor(min(ys)))
    right, bottom = min(image.width, math.ceil(max(xs))), min(image.height, math.ceil(max(ys)))
    if right <= left or bottom <= top:
        return 0.
    pixels = np.asarray(image.crop((left, top, right, bottom)).convert("L"))
    height, width = pixels.shape
    selected = np.zeros((height, width), dtype=np.uint8)
    points = np.rint(np.asarray(polygon) - [left, top]).astype(np.int32)
    cv2.fillPoly(selected, [points], 1)
    ink = ((pixels < REGION_OPTIONS["foreground_threshold"]) & (selected > 0)).astype(np.uint8)
    # Ruled-table borders must not dominate the denominator or masquerade as
    # covered letters. A rule must span >=80% of this crop (at least 40px).
    # Short punctuation and minus signs are retained.
    if width >= 50:
        ink &= 1 - cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(40, math.ceil(width * .8))), dtype=np.uint8))
    if height >= 50:
        ink &= 1 - cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(40, math.ceil(height * .8)), 1), dtype=np.uint8))
    total = int(ink.sum())
    if total == 0:
        return 0.
    covered = np.zeros((height, width), dtype=np.uint8)
    for a, b, c, d in boxes:
        x0, y0, x1, y1 = max(0, math.floor(a-left)), max(0, math.floor(b-top)), min(width, math.ceil(c-left)), min(height, math.ceil(d-top))
        if x0 < x1 and y0 < y1:
            covered[y0:y1, x0:x1] = 1
    return int((ink & covered).sum()) / total


def uncovered_lines(polygons, native, size, image=None):
    width, height = size
    tolerance = REGION_OPTIONS["native_tolerance_pixels"]
    boxes = [[b[0] * width - tolerance, b[1] * height - tolerance, b[2] * width + tolerance, b[3] * height + tolerance]
             for b in (item["bbox"] for item in native if item.get("_native_valid", True))]
    missing = []
    for polygon in polygons:
        xs, ys = zip(*polygon)
        box = rectangle([min(xs), min(ys), max(xs), max(ys)], width, height)
        measured = ink_coverage(polygon, boxes, image) if box and image is not None else coverage(box, boxes) if box else 0.
        if box and measured < REGION_OPTIONS["native_line_coverage"]:
            missing.append(polygon)
    return missing


def native_table_cells(page, owner, native, number):
    """Bounded PyMuPDF geometry within this region, with no OCR fallback."""
    import pymupdf
    from pp_structure import MAX_CELLS, MAX_AXIS, MAX_GRID_SLOTS
    width, height = page.rect.width, page.rect.height
    rotation, rotation_matrix = page.rotation, page.rotation_matrix
    a, b, c, d = owner["bbox"]
    clip = pymupdf.Rect(a * width, b * height, c * width, d * height) * page.derotation_matrix
    result = []
    try:
        # find_tables and transformation_matrix both need the original native
        # coordinates; clearing Rotate avoids the known CropBox+Rotate bug.
        page.set_rotation(0)
        tables = page.find_tables(clip=clip).tables
        for table_index, table in enumerate(tables, 1):
            if not (1 <= table.row_count <= MAX_AXIS and 1 <= table.col_count <= MAX_AXIS
                    and table.row_count * table.col_count <= MAX_GRID_SLOTS and len(table.cells) <= MAX_CELLS):
                continue
            xs = sorted({round(value, 3) for box in table.cells for value in (box[0], box[2])})
            ys = sorted({round(value, 3) for box in table.cells for value in (box[1], box[3])})
            candidates = []
            for box in table.cells:
                left, top, right, bottom = box
                col, endcol = [min(range(len(xs)), key=lambda n: abs(xs[n] - value)) for value in (left, right)]
                row, endrow = [min(range(len(ys)), key=lambda n: abs(ys[n] - value)) for value in (top, bottom)]
                if endcol <= col or endrow <= row:
                    continue
                visible = bbox_pixels(pymupdf.Rect(box) * rotation_matrix, width, height)
                # Text is associated after the complete grid is known. A line
                # crossing two columns must not be copied into one of them.
                candidates.append(block("", visible, "native",
                    f"region[{owner['id']}]/native-table[{table_index}]", table_id=f"p{number}-r{owner['id']}-t{table_index}",
                    row=row, column=col, row_span=endrow - row, column_span=endcol - col))
            if candidates and valid_geometry(candidates, [item["bbox"] for item in candidates], 1, 1):
                result.extend(candidates)
    except (ValueError, RuntimeError, IndexError, TypeError):
        owner["reasons"].append("TABLE_STRUCTURE_UNAVAILABLE")
    finally:
        page.set_rotation(rotation)
    return result
