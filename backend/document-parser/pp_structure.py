"""Plain PAR v1 adapter. Independent OCR readings are never silently replaced.

Geometry guards are conservative execution policy, not a certificate of accuracy.
"""
from html.parser import HTMLParser
import math
import re

from common import bbox_pixels, block, normalize

MAX_CELLS, MAX_AXIS, MAX_GRID_SLOTS = 2048, 1000, 10000


def unrotate_point(x, y, turns, width, height):
    return ((x, y), (width - y, x), (width - x, height - y), (y, height - x))[turns]


def map_box(box, turns, width, height):
    points = [unrotate_point(x, y, turns, width, height) for x, y in
              ((box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3]))]
    xs, ys = zip(*points)
    return bbox_pixels((min(xs), min(ys), max(xs), max(ys)), width, height)


def rectangle(value, width, height):
    try:
        if len(value) != 4 or not all(math.isfinite(float(x)) for x in value):
            return None
        a, b, c, d = map(float, value)
        if a >= c or b >= d or a < -width * .02 or b < -height * .02 or c > width * 1.02 or d > height * 1.02:
            return None
        result = [max(0., a), max(0., b), min(float(width), c), min(float(height), d)]
        return result if result[0] < result[2] and result[1] < result[3] else None
    except (TypeError, ValueError):
        return None


def polygon_box(points, width, height):
    try:
        xs, ys = zip(*points)
        return rectangle([min(xs), min(ys), max(xs), max(ys)], width, height)
    except (TypeError, ValueError):
        return None


def intersection(a, b):
    return max(0., min(a[2], b[2]) - max(a[0], b[0])) * max(0., min(a[3], b[3]) - max(a[1], b[1]))


def area(box):
    return (box[2] - box[0]) * (box[3] - box[1])


class TableHTML(HTMLParser):
    """Read plain cell text only; no markup or external resource is emitted."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cells, self.occupied = [], set()
        # Preserve text independently of whether a cell can enter the bounded
        # logical grid. Invalid spans must not erase the only available reading.
        # The HTML input is bounded to 1M characters by table_content().
        self.plain_parts = []
        self.row, self.column, self.current, self.invalid = -1, 0, None, False

    def handle_starttag(self, tag, attrs):
        if tag in ("td", "th", "br"):
            self.plain_parts.append("\n")
        if tag == "tr":
            self.invalid |= self.current is not None
            self.row, self.column = self.row + 1, 0
        elif tag in ("td", "th"):
            if self.current is not None or not 0 <= self.row < MAX_AXIS or len(self.cells) >= MAX_CELLS:
                self.invalid = True
                return
            attributes = dict(attrs)
            try:
                rs, cs = int(attributes.get("rowspan", "1")), int(attributes.get("colspan", "1"))
            except (TypeError, ValueError):
                self.invalid = True
                return
            while (self.row, self.column) in self.occupied:
                self.column += 1
            if not (1 <= rs <= MAX_AXIS and 1 <= cs <= MAX_AXIS and self.column + cs <= MAX_AXIS
                    and self.row + rs <= MAX_AXIS and len(self.occupied) + rs * cs <= MAX_GRID_SLOTS):
                self.invalid = True
                return
            slots = {(r, c) for r in range(self.row, self.row + rs) for c in range(self.column, self.column + cs)}
            self.invalid |= bool(slots & self.occupied)
            self.occupied.update(slots)
            self.current = {"row": self.row, "column": self.column, "row_span": rs, "column_span": cs, "text": ""}
            self.cells.append(self.current)
            self.column += cs
        elif tag == "br" and self.current is not None:
            self.current["text"] += "\n"

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self.current = None
        elif tag == "tr" and self.current is not None:
            self.invalid, self.current = True, None

    def handle_data(self, text):
        self.plain_parts.append(text)
        if self.current is not None:
            self.current["text"] += text


def table_content(markup):
    parser = TableHTML()
    if not isinstance(markup, str) or len(markup) > 1_000_000:
        return [], False, ""
    parser.feed(markup)
    parser.close()
    valid = not parser.invalid and parser.current is None and bool(parser.cells)
    valid = valid and all(c["row"] + c["row_span"] <= parser.row + 1 for c in parser.cells)
    return parser.cells, valid, "".join(parser.plain_parts)


def table_cells(markup):
    cells, valid, _plain = table_content(markup)
    return cells, valid


def valid_geometry(cells, boxes, width, height):
    if not cells or len(cells) != len(boxes) or any(b is None for b in boxes):
        return False
    axes = {0, 1, 2, 3}
    for i, (left, a) in enumerate(zip(cells, boxes)):
        for right, b in zip(cells[i + 1:], boxes[i + 1:]):
            if intersection(a, b) / min(area(a), area(b)) > .2:
                return False
            rows = left["row"] < right["row"] + right["row_span"] and right["row"] < left["row"] + left["row_span"]
            cols = left["column"] < right["column"] + right["column_span"] and right["column"] < left["column"] + left["column_span"]
            if rows and cols:
                return False
            dx, dy = (b[0] + b[2] - a[0] - a[2]) / 2, (b[1] + b[3] - a[1] - a[3]) / 2
            for orientation in tuple(axes):
                u, v = ((dx, dy), (dy, -dx), (-dx, -dy), (-dy, dx))[orientation]
                if rows and (right["column"] - left["column"]) * u <= 0:
                    axes.discard(orientation)
                if cols and (right["row"] - left["row"]) * v <= 0:
                    axes.discard(orientation)
            if not axes:
                return False
    return True


def convert_result(data, width, height):
    angle = data.get("doc_preprocessor_res", {}).get("angle", 0)
    if angle not in (0, 90, 180, 270):
        raise ValueError("Unsupported PP-Structure orientation")
    turns = int(angle) // 90
    rw, rh = (height, width) if turns % 2 else (width, height)
    if (data.get("width"), data.get("height")) != (rw, rh):
        raise ValueError("PP-Structure dimensions differ from source orientation")
    overall = data["overall_ocr_res"]
    blocks, reasons = [], ["OCR_UNVERIFIED"]
    for index, text in enumerate(overall.get("rec_texts", [])):
        if not normalize(text):
            continue
        polygons = overall.get("rec_polys", [])
        box = polygon_box(polygons[index] if index < len(polygons) else [], rw, rh)
        if box is None:
            box = [0, 0, rw, rh]
            reasons.append("OCR_GEOMETRY_UNAVAILABLE")
        item = block(text, map_box(box, turns, width, height), "ocr", f"ocr/overall/line[{index + 1}]")
        scores = overall.get("rec_scores", [])
        if index < len(scores) and math.isfinite(float(scores[index])):
            item["confidence"] = max(0., min(1., float(scores[index])))
        blocks.append(item)
    layouts = [rectangle(item["coordinate"], rw, rh) for item in data.get("layout_det_res", {}).get("boxes", []) if item.get("label") == "table"]
    layouts = [box for box in layouts if box is not None]
    compact = lambda text: re.sub(r"\s+", "", normalize(text))
    overall_text = compact("\n".join(overall.get("rec_texts", [])))
    for index, table in enumerate(data.get("table_res_list", []), 1):
        cells, valid_html, plain_text = table_content(table.get("pred_html"))
        boxes = [rectangle(value, rw, rh) for value in table.get("cell_box_list", [])]
        usable = [box for box in boxes if box is not None]
        extent = [min(b[0] for b in usable), min(b[1] for b in usable), max(b[2] for b in usable), max(b[3] for b in usable)] if usable else [0, 0, rw, rh]
        candidate = max(layouts, key=lambda b: intersection(b, extent) / (area(b) + area(extent) - intersection(b, extent))) if layouts else extent
        if valid_html and valid_geometry(cells, boxes, rw, rh):
            reasons.append("TABLE_STRUCTURE_UNVERIFIED")
            for cell, box in zip(cells, boxes):
                blocks.append(block(cell["text"], map_box(box, turns, width, height), "ocr",
                    f'ocr/table[{index}]/cell[{cell["row"]},{cell["column"]}]', table_id=f"ocr-t{index}",
                    **{key: cell[key] for key in ("row", "column", "row_span", "column_span")}))
        else:
            reasons.append("TABLE_STRUCTURE_REJECTED")
            text = plain_text
            if normalize(text):
                blocks.append(block(text, map_box(candidate, turns, width, height), "ocr", f"ocr/table[{index}]/unstructured"))
        table_raw = "\n".join(table.get("table_ocr_pred", {}).get("rec_texts", []))
        if normalize(table_raw):
            # PaddleX does not inverse-map these polygons after internal table
            # rotation. Preserve raw lines with an honest enclosing-table locator.
            blocks.append(block(table_raw, map_box(candidate, turns, width, height), "ocr", f"ocr/table[{index}]/recognition-text"))
        if any(compact(cell["text"]) and compact(cell["text"]) not in overall_text for cell in cells):
            reasons.append("OCR_TABLE_TEXT_DIFFERENCE")
    return blocks, angle, len(overall.get("dt_polys", [])), sorted(set(reasons))
