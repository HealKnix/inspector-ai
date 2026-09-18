"""Generate explicitly synthetic integration documents outside Git for real OCR checks."""
import argparse
import io
import json
from pathlib import Path
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchmark import outside_repo
from config import Settings


def main():
    import pymupdf
    from PIL import Image, ImageDraw, ImageFont
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--font", type=Path, default=Settings.environment().font)
    args = parser.parse_args()
    root = outside_repo(args.output)
    root.mkdir(parents=True, exist_ok=True)
    text = ["СИНТЕТИЧЕСКИЙ АКТ № 52", "Шифр РД-01/А+2"]
    image = Image.new("RGB", (1100, 260), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(args.font), 42)
    for index, line in enumerate(text):
        draw.text((55, 50 + index * 80), line, font=font, fill="black")
    png = io.BytesIO()
    image.save(png, "PNG")
    document = '''<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="5500000" cy="1300000"/>
<wp:docPr id="1" name="Synthetic image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="synthetic.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5500000" cy="1300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'''
    with zipfile.ZipFile(root / "synthetic-image.docx", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/synthetic.png"/></Relationships>')
        archive.writestr("word/media/synthetic.png", png.getvalue())
    native = pymupdf.open()
    page = native.new_page(width=595, height=842)
    page.insert_font(fontname="SyntheticFont", fontfile=str(args.font))
    for index, line in enumerate(text):
        page.insert_text((60, 100 + index * 45), line, fontname="SyntheticFont", fontsize=20)
    page.set_cropbox(pymupdf.Rect(20, 30, 575, 812))
    native.save(root / "synthetic-native.pdf")
    page = native.new_page(width=600, height=240)
    page.insert_image(pymupdf.Rect(25, 50, 575, 180), stream=png.getvalue())
    page.set_cropbox(pymupdf.Rect(10, 10, 590, 230))
    page.set_rotation(90)
    native.save(root / "synthetic-mixed.pdf")
    native.close()
    manifest = [
        {"id": "synthetic-image-docx", "path": "synthetic-image.docx", "truth": {"page_number": 1, "text": "\n".join(text)}},
        {"id": "synthetic-native-pdf", "path": "synthetic-native.pdf", "truth": {"page_number": 1, "text": "\n".join(text)}},
        {"id": "synthetic-mixed-pdf", "path": "synthetic-mixed.pdf", "truth": {"page_number": 2, "text": "\n".join(text)}},
    ]
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Created explicitly synthetic image-only DOCX, native/mixed PDF and annotated manifest outside the repository")


if __name__ == "__main__":
    main()
