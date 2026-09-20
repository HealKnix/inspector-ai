"""Generate synthetic, public layout fixtures before inference; no OCR/models."""
import argparse
import hashlib
import json
from pathlib import Path

import pymupdf as fitz


def table(page, box):
    x0, y0, x1, y1 = box
    for row in range(5):
        y = y0 + (y1 - y0) * row / 4
        page.draw_line((x0, y), (x1, y))
    for col in range(4):
        x = x0 + (x1 - x0) * col / 3
        page.draw_line((x, y0), (x, y1))
    for row in range(4):
        for col in range(3):
            page.insert_text((x0 + 8 + col * (x1-x0)/3, y0+20+row*(y1-y0)/4),
                             ["Parameter", "Value", "Unit"][col] if row == 0 else f"R{row} C{col}", fontsize=11)


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    cases = []
    for name in ("native-table", "mixed", "broken-encoding", "crop-0", "crop-90", "crop-180", "crop-270"):
        doc = fitz.open()
        page = doc.new_page(width=640, height=800)
        page.insert_text((60, 75), "Synthetic layout control", fontsize=17)
        expected = [("text", [55, 52, 400, 82])]
        if name == "broken-encoding":
            page.insert_text((60, 140), "AAAA valid visible text but broken extraction", fontsize=14)
            font_xref = page.get_fonts()[0][0]
            mappings = '\n'.join(f'<{code:02X}> <{(0xFFFD if code == 65 else code):04X}>' for code in range(32,127))
            cmap = ("/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Broken def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 95 beginbfchar\n" + mappings + "\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end").encode('ascii')
            xref = doc.get_new_xref()
            doc.update_object(xref, "<<>>")
            doc.update_stream(xref, cmap)
            doc.xref_set_key(font_xref, "ToUnicode", f"{xref} 0 R")
            expected.append(("text", [55, 115, 450, 150]))
        else:
            table(page, (60, 120, 580, 300))
            expected.append(("table", [60, 120, 580, 300]))
        if name == "mixed":
            raster = fitz.open()
            rp = raster.new_page(width=520, height=70)
            rp.insert_text((10, 25), "Raster note beside a graphic", fontsize=15)
            rp.insert_text((10, 52), "Keep this explanation accessible", fontsize=12)
            page.insert_image(fitz.Rect(60, 340, 580, 410), stream=rp.get_pixmap(matrix=fitz.Matrix(2,2)).tobytes("png"))
            expected.append(("text", [60, 340, 580, 410]))
            page.draw_rect((80, 450, 540, 660), width=2)
            for x in (180, 300, 440):
                page.draw_line((x, 450), (x, 660))
            page.draw_line((80, 530), (540, 530))
            page.draw_line((80, 610), (540, 610))
            page.insert_text((100, 490), "A1", fontsize=9)
            page.insert_text((330, 580), "93.0", fontsize=9)
            expected.append(("graphic", [75, 445, 545, 665]))
            page.insert_text((60, 705), "Figure 1. Synthetic diagram", fontsize=12)
            expected.append(("text", [55, 688, 360, 711]))
            raster.close()
        if name.startswith("crop-"):
            page.set_cropbox(fitz.Rect(30, 40, 610, 760))
            page.set_rotation(int(name.split('-')[1]))
        pdf = output / f"{name}.pdf"
        doc.save(pdf)
        doc.close()
        with fitz.open(pdf) as reopened:
            page = reopened[0]
            image = output / f"{name}.png"
            page.get_pixmap(matrix=fitz.Matrix(200/72, 200/72), alpha=False).save(image)
            regions = []
            for kind, box in expected:
                rect = fitz.Rect(box)
                if name.startswith("crop-"):
                    rect -= (30, 40, 30, 40)
                rect *= page.rotation_matrix
                regions.append({"kind": kind, "bbox": [rect.x0/page.rect.width, rect.y0/page.rect.height, rect.x1/page.rect.width, rect.y1/page.rect.height]})
            # Disable MuPDF's CID substitution: the PDF ToUnicode mapping is corrupt,
            # even when the default extractor conceals it with a guessed glyph code.
            if name == "broken-encoding" and '\ufffd' not in page.get_text(flags=0):
                raise AssertionError("Synthetic corrupt encoding must extract replacement characters")
            cases.append({"id": name, "image_path": str(image.resolve()), "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                          "source_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "page_number": 1, "split": "development", "expected_regions": regions})
    (output / 'cases.json').write_text(json.dumps(cases, indent=2), encoding='utf8')
    return cases


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps({'cases': len(generate(args.output))}))
