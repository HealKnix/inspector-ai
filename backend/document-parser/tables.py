"""Bounded ruled-table geometry; does not infer borderless tables or business headers."""
from common import block


def cluster(values, tolerance):
    groups = []
    for value in sorted(values):
        if not groups or value - groups[-1][-1] > tolerance:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [sum(group) / len(group) for group in groups]


def ruled_cells(image):
    import cv2
    import numpy as np
    # Geometry works in this scaled raster and returns normalized coordinates.
    scale = min(1, 2400 / max(image.size))
    gray = cv2.cvtColor(np.array(image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))))), cv2.COLOR_RGB2GRAY)
    height, width = gray.shape
    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(20, width // 40)), np.uint8))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(20, height // 40), 1), np.uint8))
    grid = cv2.dilate(cv2.bitwise_or(horizontal, vertical), np.ones((3, 3), np.uint8))
    contours, hierarchy = cv2.findContours(grid, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    tables = []
    for index, contour in enumerate(contours):
        if hierarchy[0][index][3] != -1:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if w < width * .12 or h < 35:
            continue
        cells = []
        for child_index, child in enumerate(contours):
            if hierarchy[0][child_index][3] != index:
                continue
            cx, cy, cw, ch = cv2.boundingRect(child)
            if cw >= 12 and ch >= 8:
                cells.append((cx, cy, cx + cw, cy + ch))
        if len(cells) < 4:
            continue
        xs = cluster([v for cell in cells for v in (cell[0], cell[2])], 7)
        ys = cluster([v for cell in cells for v in (cell[1], cell[3])], 7)
        if len(xs) < 3 or len(ys) < 3:
            continue
        table = []
        for cell in cells:
            left, top, right, bottom = cell
            col, endcol = [min(range(len(xs)), key=lambda n: abs(xs[n] - x)) for x in (left, right)]
            row, endrow = [min(range(len(ys)), key=lambda n: abs(ys[n] - y)) for y in (top, bottom)]
            if endcol > col and endrow > row:
                table.append({"bbox": [left / width, top / height, right / width, bottom / height],
                              "row": row, "column": col, "row_span": endrow - row, "column_span": endcol - col})
        if len(table) >= 4:
            tables.append(table)
    return sorted(tables, key=lambda table: min(cell["bbox"][1] for cell in table))


def structure_tables(blocks, image, page_number):
    tables = ruled_cells(image)
    if not tables:
        # OCR already returns reading order in the classified orientation. Sorting
        # its mapped viewer coordinates would reverse lines on a rotated page.
        return blocks, False
    consumed = set()
    result = []
    for table_index, cells in enumerate(tables):
        for cell in sorted(cells, key=lambda c: (c["row"], c["column"])):
            matched = []
            for index, item in enumerate(blocks):
                x0, y0, x1, y1 = item["bbox"]
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                a, b, c, d = cell["bbox"]
                if index not in consumed and a <= cx <= c and b <= cy <= d:
                    consumed.add(index)
                    matched.append(item)
            matched.sort(key=lambda item: (item["bbox"][1], item["bbox"][0]))
            source = "ocr" if any(item["source"] == "ocr" for item in blocks) else "native"
            item = block("\n".join(item["raw_text"] for item in matched), cell["bbox"], source,
                         table_id=f"p{page_number}-t{table_index + 1}",
                         **{k: v for k, v in cell.items() if k != "bbox"})
            scores = [part["confidence"] for part in matched if part["confidence"] is not None]
            item["confidence"] = min(scores) if scores else None
            result.append(item)
    result.extend(item for index, item in enumerate(blocks) if index not in consumed)
    result.sort(key=lambda item: (round(item["bbox"][1], 2), item["bbox"][0]))
    return result, bool(tables)
