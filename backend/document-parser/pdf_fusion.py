"""Conservative selection of PDF text readings and table associations.

All coordinates are visible-page-normalized. Geometry selects evidence, never
repairs characters or splits a string at a guessed column boundary. Original
readings remain in source blocks and/or provenance alternatives.
"""
from common import normalize
from pp_structure import area, intersection


def native_is_valid(item):
    return item.get("native_valid", item.get("_native_valid", False)) is True


def fragment(item, role="selected"):
    return {"source": item["source"], "raw_text": item["raw_text"], "bbox": list(item["bbox"]),
            "native_valid": native_is_valid(item) if item["source"] == "native" else None, "role": role}


def provenance(fragments, *, reasons=(), ambiguous=False):
    sources = {item["source"] for item in fragments}
    return {"schema_version": 1, "status": "ambiguous" if ambiguous else "selected",
            "method": "hybrid" if len(sources) > 1 else next(iter(sources), "native"),
            "fragments": fragments, "reasons": sorted(set(reasons))}


def annotate(item):
    if item["source"] == "native":
        item["native_valid"] = native_is_valid(item)
    if item["raw_text"] and "provenance" not in item:
        invalid = item["source"] == "native" and not item["native_valid"]
        item["provenance"] = provenance([fragment(item, "alternative" if invalid else "selected")],
            ambiguous=invalid, reasons=["NATIVE_TEXT_UNUSABLE"] if invalid else [])
        if invalid:
            item["include_in_main"] = False


def eligible(item):
    return (item.get("include_in_main") is not False
            and item.get("provenance", {}).get("status") != "ambiguous"
            and (item["source"] != "native" or native_is_valid(item)))


def same_ink(left, right):
    # Recognition boxes contain padding; use the smaller evidence box. This
    # also catches a recognizer reading a whole native+raster line: we cannot
    # cut characters out of that reading without character-level geometry.
    return intersection(left["bbox"], right["bbox"]) / max(1e-12, min(area(left["bbox"]), area(right["bbox"]))) >= .5


def add_alternatives(item, others, reason):
    previous = item["provenance"]
    fragments = list(previous["fragments"])
    for other in others:
        candidate = fragment(other, "alternative")
        if candidate not in fragments:
            fragments.append(candidate)
    item["provenance"] = provenance(fragments, reasons=previous["reasons"] + [reason],
                                     ambiguous=previous["status"] == "ambiguous")


def reconcile_readings(native, recognized, *, include_hidden_native=False):
    """Keep usable native, expose conflicts, never concatenate two readings."""
    for item in native + recognized:
        annotate(item)
    selected = []
    def native_candidate(item):
        return (native_is_valid(item) and item.get("provenance", {}).get("status") != "ambiguous"
                and (include_hidden_native or item.get("include_in_main") is not False))
    for item in native:
        if not native_candidate(item):
            continue
        overlaps = [other for other in selected if same_ink(item, other)]
        if overlaps:
            identical = all(normalize(other["raw_text"]) == normalize(item["raw_text"]) for other in overlaps)
            reason = "DUPLICATE_NATIVE_READING" if identical else "NATIVE_TEXT_CONFLICT"
            item["include_in_main"] = False
            item["provenance"] = provenance([fragment(item, "selected" if identical else "alternative")] + [fragment(other, "alternative") for other in overlaps],
                                             reasons=[reason], ambiguous=not identical)
            for other in overlaps:
                add_alternatives(other, [item], "NATIVE_DUPLICATE_ALTERNATIVE_RETAINED" if identical else reason)
                if not identical:
                    other["include_in_main"] = False
                    other["provenance"]["status"] = "ambiguous"
        else:
            selected.append(item)
    selected = [item for item in selected if native_candidate(item)]
    conflicted_native = [item for item in native if native_is_valid(item)
                         and "NATIVE_TEXT_CONFLICT" in item.get("provenance", {}).get("reasons", [])]
    for item in recognized:
        conflicts = [other for other in conflicted_native if same_ink(item, other)]
        if conflicts:
            # A third reading cannot silently decide between incompatible
            # native originals merely because both originals were withheld.
            item["include_in_main"] = False
            item["provenance"] = provenance([fragment(item, "alternative")] + [fragment(other, "alternative") for other in conflicts],
                                             reasons=["NATIVE_CONFLICT_UNRESOLVED"], ambiguous=True)
            continue
        overlaps = [other for other in selected if same_ink(item, other)]
        if not overlaps:
            continue
        identical = len(overlaps) == 1 and normalize(item["raw_text"]) == normalize(overlaps[0]["raw_text"])
        reason = "DUPLICATE_OCR_READING" if identical else "NATIVE_OCR_TEXT_CONFLICT"
        item["include_in_main"] = False
        item["provenance"] = provenance([fragment(item, "alternative")] + [fragment(other) for other in overlaps],
                                         reasons=[reason], ambiguous=not identical)
        for other in overlaps:
            add_alternatives(other, [item], reason)
    # The detector can emit overlapping crops. OCR-only duplicates/conflicts
    # require the same protection when no usable native text covers them.
    selected_ocr = []
    for item in recognized:
        if not eligible(item):
            continue
        overlaps = [other for other in selected_ocr if same_ink(item, other)]
        if not overlaps:
            selected_ocr.append(item)
            continue
        identical = all(normalize(other["raw_text"]) == normalize(item["raw_text"]) for other in overlaps)
        reason = "DUPLICATE_OCR_READING" if identical else "OCR_TEXT_CONFLICT"
        item["include_in_main"] = False
        item["provenance"] = provenance([fragment(item, "selected" if identical else "alternative")] + [fragment(other, "alternative") for other in overlaps],
                                         reasons=[reason], ambiguous=not identical)
        for other in overlaps:
            add_alternatives(other, [item], reason)
            if not identical:
                other["include_in_main"] = False
                other["provenance"]["status"] = "ambiguous"


def slots(cell, name):
    return set(range(cell[name], cell[name] + cell[f"{name}_span"]))


def association(item, cells):
    """Return a unique cell or an explicit row association; never a guess."""
    matches = [(cell, intersection(item["bbox"], cell["bbox"]) / max(1e-12, area(item["bbox"]))) for cell in cells]
    matches = [(cell, fraction) for cell, fraction in matches if fraction >= .1]
    if not matches:
        return None, None
    tables = {cell["table_id"] for cell, _ in matches}
    rows = set.intersection(*(slots(cell, "row") for cell, _ in matches))
    columns = set.union(*(slots(cell, "column") for cell, _ in matches))
    coverage = min(1., sum(fraction for _, fraction in matches))
    if len(matches) == 1 and matches[0][1] >= .8:
        return matches[0][0], None
    associated = len(tables) == 1 and len(rows) == 1 and coverage >= .8
    return None, {"schema_version": 1, "status": "associated" if associated else "ambiguous",
                  "table_id": next(iter(tables)) if len(tables) == 1 else None,
                  "rows": sorted(rows if rows else set.union(*(slots(cell, "row") for cell, _ in matches))),
                  "columns": sorted(columns),
                  "reasons": ["CROSS_COLUMN_NATIVE_TEXT" if associated else "TABLE_TEXT_ASSOCIATION_AMBIGUOUS"]}


def table_orientation(cells):
    # The logical grid, rather than page Y, determines reading order after /Rotate.
    for i, left in enumerate(cells):
        for right in cells[i + 1:]:
            dx = right["bbox"][0] + right["bbox"][2] - left["bbox"][0] - left["bbox"][2]
            dy = right["bbox"][1] + right["bbox"][3] - left["bbox"][1] - left["bbox"][3]
            if slots(left, "row") & slots(right, "row") and left["column"] != right["column"]:
                direction = 1 if right["column"] > left["column"] else -1
                return (0 if dx * direction > 0 else 2) if abs(dx) >= abs(dy) else (1 if dy * direction > 0 else 3)
            if slots(left, "column") & slots(right, "column") and left["row"] != right["row"]:
                direction = 1 if right["row"] > left["row"] else -1
                return (1 if dx * direction < 0 else 3) if abs(dx) >= abs(dy) else (0 if dy * direction > 0 else 2)
    return 0


def reading_key(item, orientation):
    a, b, c, d = item["bbox"]
    x, y = (a+c)/2, (b+d)/2
    return ((y, x), (-x, y), (-y, -x), (x, -y))[orientation]


def reconcile_table(cells, native, recognized):
    """Select cell text from located evidence, retaining the table model output.

    Cells carry geometry from the table detector. A line crossing columns stays
    whole as a row-linked source block; it is never copied into an arbitrary cell.
    """
    assignments = {id(cell): [] for cell in cells}
    crossing = []
    for item in native + recognized:
        annotate(item)
        if not eligible(item):
            continue
        cell, link = association(item, cells)
        if cell is not None:
            assignments[id(cell)].append(item)
        elif link is not None:
            item["table_link"] = link
            crossing.append(item)
    orientations = {table: table_orientation([cell for cell in cells if cell["table_id"] == table])
                    for table in {cell["table_id"] for cell in cells}}
    for cell in cells:
        # Native cells start as geometry only, and get their value here.
        if cell["source"] == "native":
            cell["native_valid"] = True
        original = fragment(cell, "alternative") if cell["raw_text"] else None
        candidates = assignments[id(cell)]
        if candidates:
            candidates.sort(key=lambda item: reading_key(item, orientations[cell["table_id"]]))
            selected = [fragment(item) for item in candidates]
            alternatives = [part for item in candidates for part in item.get("provenance", {}).get("fragments", [])
                            if part["role"] == "alternative"]
            if original and original not in alternatives:
                alternatives.append(original)
            text = "\n".join(item["raw_text"] for item in candidates)
            cell.update(raw_text=text, normalized_text=normalize(text),
                        source="native" if all(item["source"] == "native" for item in candidates) else "ocr")
            if cell["source"] == "native":
                cell["native_valid"] = True
            else:
                cell.pop("native_valid", None)
            reasons = ["TABLE_TEXT_FROM_LOCATED_FRAGMENTS"]
            if original and normalize(original["raw_text"]) != normalize(text):
                reasons.append("TABLE_MODEL_TEXT_ALTERNATIVE")
            cell["provenance"] = provenance(selected + alternatives, reasons=reasons)
            for item in candidates:
                item["include_in_main"] = False
        elif cell["raw_text"]:
            # structure_region supplies our located lines to a matching model,
            # with use_ocr_model=False. Its HTML is not an independent reading
            # and cannot support a value when none of those lines locates here.
            cell["include_in_main"] = False
            cell["provenance"] = provenance([fragment(cell, "alternative")], ambiguous=True,
                                             reasons=["TABLE_TEXT_WITHOUT_LOCATED_SUPPORT"])
        overlaps = [item for item in crossing if intersection(cell["bbox"], item["bbox"]) / max(1e-12, area(item["bbox"])) >= .1]
        if overlaps and cell["raw_text"]:
            # A model may have copied the crossing string into just one cell.
            # Keep that reading for inspection but withhold its asserted value.
            cell["include_in_main"] = False
            cell["provenance"] = provenance([fragment(cell, "alternative")] + [fragment(item, "alternative") for item in overlaps],
                                             ambiguous=True, reasons=["TABLE_CELL_CROSSED_BY_UNSPLIT_TEXT"])
    return cells
