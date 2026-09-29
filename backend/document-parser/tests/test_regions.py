"""Synthetic behavioral contracts: model quality is measured in the local probe."""
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pymupdf
from PIL import Image, ImageDraw

from common import block
from config import Settings
from ocr import LocalOCR
from pdf_parser import render_region
from pdf_regions import (coverage, ink_coverage, layout_regions, residual_regions, uncovered_lines,
                         valid_native, intersection)
from pipeline import parse


def polygon(box, width, height):
    a, b, c, d = box
    return [[a * width, b * height], [c * width, b * height], [c * width, d * height], [a * width, d * height]]


class RegionReader:
    def __init__(self, labels, lines=()):
        self.labels, self.lines = labels, lines
        self.recognized, self.detected = [], 0
        self.tables = 0

    def layout(self, image):
        return [{"label": kind, "score": score, "coordinate": [box[0] * image.width, box[1] * image.height,
                    box[2] * image.width, box[3] * image.height]} for kind, box, score in self.labels]

    def detect_lines(self, image):
        self.detected += 1
        return [polygon(box, image.width, image.height) for box in self.lines]

    def recognize_lines(self, image, polygons):
        self.recognized.extend(polygons)
        result = []
        for points in polygons:
            xs, ys = zip(*points)
            item = block("SYNTHETIC SCANNED -12.5", [min(xs)/image.width, min(ys)/image.height,
                                                    max(xs)/image.width, max(ys)/image.height], "ocr")
            item["confidence"] = .95
            result.append(item)
        return result

    def structure_region(self, _image, _lines):
        self.tables += 1
        return [block("SYNTHETIC SCANNED -12.5", [.1,.1,.5,.5], "ocr", table_id="t1", row=0,column=0,row_span=1,column_span=1),
                block("", [.5,.1,.9,.5], "ocr", table_id="t1", row=0,column=1,row_span=1,column_span=1)], []


class RegionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        (root / "originals").mkdir()
        (root / "derived").mkdir()
        self.settings = Settings(root, root, root / "unused-font", render_dpi=144)
        self.versions = {"renderer": "synthetic", "pdf_region_profile": "paddle-regions-v1"}

    def tearDown(self):
        self.directory.cleanup()

    def run_pdf(self, document, reader):
        data = document.tobytes()
        key = str(uuid.uuid4())
        (self.settings.storage / "originals" / key).write_bytes(data)
        return parse({"schema_version":1,"request_id":str(uuid.uuid4()),"storage_key":key,
                      "source_sha256":hashlib.sha256(data).hexdigest(),"format":"pdf"},
                     self.settings,self.versions,reader,lambda *_:None)

    def test_coverage_union_not_sum_and_two_pixel_tolerance(self):
        self.assertEqual(coverage([0,0,100,10], [[0,0,50,10], [0,0,50,10]]), .5)
        native = [{"bbox":[.02,.02,.88,.98],"_native_valid":True}]
        self.assertEqual(uncovered_lines([polygon([0,0,1,1],100,10)],native,(100,10)), [])
        native[0]["_native_valid"] = False
        self.assertEqual(len(uncovered_lines([polygon([0,0,1,1],100,10)],native,(100,10))),1)
        self.assertFalse(valid_native("\ufffd",[1,0],[0,0,10,10]))
        self.assertFalse(valid_native("A",[0,0],[0,0,10,10]))
        self.assertFalse(valid_native("A\ue001",[1,0],[0,0,10,10]))

    def test_ink_coverage_ignores_white_detector_margin_and_table_rules(self):
        image=Image.new("RGB",(200,60),"white");draw=ImageDraw.Draw(image)
        # Synthetic glyph strokes, with large detector margins around them.
        for x in (40,50,60):draw.line((x,20,x,40),fill="black",width=3)
        draw.line((40,30,60,30),fill="black",width=3)
        draw.line((0,0,199,0),fill="black",width=2)
        points=polygon([0,0,1,1],200,60)
        self.assertEqual(ink_coverage(points,[[37,17,63,43]],image),1.)
        self.assertLess(coverage([0,0,200,60],[[37,17,63,43]]),.9)
        draw.text((110,22),"RASTER",fill="black")
        self.assertLess(ink_coverage(points,[[37,17,63,43]],image),.9)
        self.assertEqual(ink_coverage(points,[[0,0,200,60]],Image.new("RGB",(200,60),"white")),0.)
        ruled=Image.new("RGB",(200,60),"white");ImageDraw.Draw(ruled).line((0,0,199,0),fill="black",width=2)
        self.assertEqual(ink_coverage(points,[[0,0,200,60]],ruled),0.)

    def test_covered_native_no_recognition_and_partial_only_missing_line(self):
        doc=pymupdf.open(); page=doc.new_page(width=300,height=200)
        page.insert_text((30,40),"NATIVE -12.5")
        bbox=page.get_text("dict")["blocks"][0]["lines"][0]["bbox"]
        native=[bbox[0]/300,bbox[1]/200,bbox[2]/300,bbox[3]/200]
        reader=RegionReader([("text",[0,0,1,1],.99)],[native])
        result=self.run_pdf(doc,reader)
        self.assertEqual(reader.recognized,[])
        self.assertEqual(result["pages"][0]["regions"][0]["method"],"native")
        reader=RegionReader([("text",[0,0,1,1],.99)],[native,[.1,.6,.7,.7]])
        result=self.run_pdf(doc,reader)
        self.assertEqual(len(reader.recognized),1)
        self.assertEqual(result["pages"][0]["regions"][0]["method"],"hybrid")
        self.assertIn("NATIVE -12.5",result["raw_text"])
        self.assertIn("SYNTHETIC SCANNED -12.5",result["raw_text"])

    def test_graphic_unknown_no_detection_no_ocr_preserve_all_native(self):
        doc=pymupdf.open(); page=doc.new_page(width=300,height=200)
        page.insert_text((30,40),"DRAWING 93.0")
        for label,score,kind in [("image",.99,"graphic"),("text",.2,"unknown"),("formula",.99,"unknown")]:
            reader=RegionReader([(label,[0,0,1,1],score)],[[.1,.1,.8,.3]])
            result=self.run_pdf(doc,reader)
            self.assertEqual(reader.detected,0); self.assertEqual(reader.recognized,[])
            self.assertIn("DRAWING 93.0",result["raw_text"])
            self.assertFalse(result["pages"][0]["blocks"][0]["include_in_main"])
            self.assertTrue(result["pages"][0]["blocks"][0]["native_valid"])
            self.assertEqual(result["pages"][0]["blocks"][0]["provenance"]["status"], "selected")
            self.assertEqual(result["pages"][0]["regions"][0]["kind"],kind)

    def test_cid_fallback_is_retained_for_audit_but_cannot_suppress_ocr(self):
        doc=pymupdf.open();page=doc.new_page(width=300,height=200)
        page.insert_text((30,50),"AAAA visible text",fontsize=14)
        font_xref=page.get_fonts()[0][0]
        mappings="\n".join(f"<{code:02X}> <{(0xFFFD if code==65 else code):04X}>" for code in range(32,127))
        cmap=("/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo "
              "<< /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Broken def "
              "/CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 95 beginbfchar\n"
              +mappings+"\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end").encode("ascii")
        xref=doc.get_new_xref();doc.update_object(xref,"<<>>");doc.update_stream(xref,cmap)
        doc.xref_set_key(font_xref,"ToUnicode",f"{xref} 0 R")
        with pymupdf.open(stream=doc.tobytes(),filetype="pdf") as reopened:
            source=reopened[0]
            original=source.get_text("dict")["blocks"][0]["lines"][0]
            original_text="".join(s["text"] for s in original["spans"])
            self.assertNotIn("\ufffd",original_text)
            self.assertIn("\ufffd",source.get_text(flags=0))
            a,b,c,d=original["bbox"]
            reader=RegionReader([("text",[0,0,1,1],.99)],[[a/300,b/200,c/300,d/200]])
            result=self.run_pdf(reopened,reader)
        native=[b for b in result["pages"][0]["blocks"] if b["source"]=="native"]
        self.assertEqual([b["raw_text"] for b in native],[original_text])
        self.assertFalse(native[0]["include_in_main"])
        self.assertFalse(native[0]["native_valid"])
        self.assertEqual(len(reader.recognized),1)
        self.assertEqual(result["pages"][0]["regions"][0]["method"],"ocr")
        self.assertIn("NATIVE_TEXT_ENCODING",result["pages"][0]["regions"][0]["reasons"])

    def test_skipped_regions_check_native_duplicates_and_conflicts_without_ocr(self):
        for label in ("image", "formula"):
            for second in ("DRAWING 93.0", "DRAWING 98.0"):
                doc=pymupdf.open(); page=doc.new_page(width=300,height=200)
                page.insert_text((30,40),"DRAWING 93.0")
                page.insert_text((30,40),second)
                reader=RegionReader([(label,[0,0,1,1],.99)],[[.1,.1,.8,.3]])
                result=self.run_pdf(doc,reader)
                native=[item for item in result["pages"][0]["blocks"] if item["source"]=="native"]
                self.assertEqual(reader.detected,0)
                self.assertEqual(reader.recognized,[])
                self.assertEqual(len(native),2)
                self.assertTrue(all(item["native_valid"] for item in native))
                self.assertTrue(all(item["include_in_main"] is False for item in native))
                if second=="DRAWING 93.0":
                    self.assertEqual(native[0]["provenance"]["reasons"],["NATIVE_DUPLICATE_ALTERNATIVE_RETAINED"])
                    self.assertEqual(native[1]["provenance"]["reasons"],["DUPLICATE_NATIVE_READING"])
                else:
                    self.assertTrue(all(item["provenance"]["status"]=="ambiguous" for item in native))
                    self.assertIn("TEXT_READING_AMBIGUOUS",result["reasons"])

    def test_graphic_only_is_not_bad_quality_or_empty(self):
        doc=pymupdf.open(); page=doc.new_page(width=300,height=200)
        page.draw_rect((20,20,250,150))
        result=self.run_pdf(doc,RegionReader([("image",[0,0,1,1],.99)]))
        self.assertEqual(result["quality"],"OK")
        self.assertNotIn("NO_READABLE_TEXT",result["reasons"])
        self.assertEqual(result["pages"][0]["regions"][0]["reasons"],["GRAPHIC_PRESERVED"])

    def test_conflicting_and_low_overlap_graphic_never_recognized(self):
        doc=pymupdf.open(); doc.new_page(width=300,height=200)
        reader=RegionReader([("text",[0,0,.8,1],.99),("image",[.5,.2,1,.8],.99)],[[.1,.1,.8,.3]])
        result=self.run_pdf(doc,reader)
        self.assertEqual(reader.detected,0)
        self.assertTrue(all(r["kind"]=="unknown" for r in result["pages"][0]["regions"]))
        # Intersection is too small to reject the text region, but this line
        # still crosses excluded pixels and must never reach recognition.
        reader=RegionReader([("text",[0,0,.8,1],.99),("image",[.79,.2,1,.8],.99)],[[.9,.3,1,.4]])
        result=self.run_pdf(doc,reader)
        self.assertEqual(reader.detected,1); self.assertEqual(reader.recognized,[])
        self.assertIn("OCR_LINE_CROSSES_EXCLUDED_REGION",result["pages"][0]["regions"][0]["reasons"])

    def test_page_frame_residual_never_covers_classified_text(self):
        image=Image.new("RGB",(400,400),"white"); draw=ImageDraw.Draw(image)
        draw.rectangle((10,10,390,390),outline="black",width=2)
        regions=layout_regions([{"label":"text","score":.99,"coordinate":[30,30,370,370]}],image,1)
        residual_regions(image,regions,1)
        self.assertGreater(len(regions),1)
        self.assertTrue(all(intersection(regions[0]["bbox"],r["bbox"])==0 for r in regions[1:]))

    def test_native_table_geometry_and_empty_cell_with_no_ocr(self):
        doc=pymupdf.open(); page=doc.new_page(width=300,height=200)
        for y in (30,90,150): page.draw_line((20,y),(280,y))
        for x in (20,150,280): page.draw_line((x,30),(x,150))
        for x,y,text in [(35,60,"A -1"),(170,60,"B"),(35,120,"C")]:page.insert_text((x,y),text)
        reader=RegionReader([("table",[0,0,1,1],.99)])
        result=self.run_pdf(doc,reader); parsed=result["pages"][0]
        self.assertEqual(reader.recognized,[]);self.assertEqual(reader.tables,0)
        self.assertEqual(parsed["regions"][0]["method"],"native_table")
        self.assertEqual(parsed["regions"][0]["table_status"],"structured")
        cells=[b for b in parsed["blocks"] if b["kind"]=="table_cell"]
        self.assertEqual(len(cells),4);self.assertTrue(any(not b["raw_text"] for b in cells))
        self.assertIn("A -1",result["raw_text"])

    def test_unconfirmed_native_table_does_not_trigger_ocr(self):
        doc=pymupdf.open(); page=doc.new_page();page.insert_text((30,40),"TABLE WITHOUT RULES")
        reader=RegionReader([("table",[0,0,1,1],.99)])
        result=self.run_pdf(doc,reader)
        self.assertEqual(reader.tables,0);self.assertEqual(reader.recognized,[])
        self.assertEqual(result["pages"][0]["regions"][0]["table_status"],"unconfirmed")

    def test_native_table_cropbox_four_rotations_preserves_cell_text(self):
        for angle in (0,90,180,270):
            doc=pymupdf.open(); page=doc.new_page(width=500,height=400)
            for y in (80,140,200):page.draw_line((100,y),(340,y))
            for x in (100,220,340):page.draw_line((x,80),(x,200))
            for x,y,text in [(110,110,"A -1"),(235,110,"B"),(110,175,"C")]:page.insert_text((x,y),text)
            page.set_cropbox(pymupdf.Rect(80,60,360,280));page.set_rotation(angle)
            reader=RegionReader([("table",[0,0,1,1],.99)])
            result=self.run_pdf(doc,reader); cells=[b for b in result["pages"][0]["blocks"] if b["kind"]=="table_cell"]
            self.assertEqual(len(cells),4,angle)
            self.assertEqual({b["raw_text"] for b in cells},{"A -1","B","C",""},angle)
            self.assertTrue(all(0<=b["bbox"][0]<b["bbox"][2]<=1 and 0<=b["bbox"][1]<b["bbox"][3]<=1 for b in cells))
            self.assertEqual(reader.recognized,[])

    def test_line_adapter_recognizes_only_supplied_crops_filters_whitespace(self):
        import numpy as np
        reader=LocalOCR.__new__(LocalOCR)
        reader.engine=Mock()
        reader.general=Mock()
        reader.general._crop_by_polys.return_value=[np.ones((10,40,3),dtype=np.uint8),np.ones((10,40,3),dtype=np.uint8)]
        reader.general.text_rec_model.side_effect=[[{"rec_text":" -12.5 ","rec_score":.95}], [{"rec_text":" \n ","rec_score":.9}]]
        result=reader.recognize_lines(Image.new("RGB",(100,100)),[polygon([.1,.1,.5,.2],100,100),polygon([.1,.4,.5,.5],100,100)])
        reader.engine.predict.assert_not_called()
        self.assertEqual(reader.general.text_rec_model.call_count,2)
        self.assertEqual([b["normalized_text"] for b in result],["-12.5"])
        reader.recognize_lines(Image.new("RGB",(100,100)),[])
        self.assertEqual(reader.general.text_rec_model.call_count,2)

    def test_detector_white_padding_maps_back_and_preserves_explicit_parameters(self):
        import numpy as np
        reader=LocalOCR.__new__(LocalOCR);reader.general=Mock()
        params={"limit_side_len":1536,"limit_type":"max","thresh":.3,"box_thresh":.6,"unclip_ratio":2.}
        reader.general.get_text_det_params.return_value=params
        reader.general.text_det_model.return_value=[{"dt_polys":[np.asarray([[26,21],[106,21],[106,41],[26,41]])]}]
        result=reader.detect_lines(Image.new("RGB",(100,40),"black"))
        args,kwargs=reader.general.text_det_model.call_args
        self.assertEqual(kwargs,params)
        self.assertEqual(args[0].shape,(72,132,3));self.assertTrue((args[0][:16]==255).all())
        self.assertEqual(result,[[[10.,5.],[90.,5.],[90.,25.],[10.,25.]]])

    def test_scan_table_uses_components_and_preserves_empty_cells(self):
        doc=pymupdf.open();doc.new_page(width=300,height=200)
        reader=RegionReader([("table",[0,0,1,1],.99)],[[.1,.1,.4,.2]])
        result=self.run_pdf(doc,reader); page=result["pages"][0]
        self.assertEqual(reader.tables,1);self.assertEqual(len(reader.recognized),1)
        self.assertEqual(page["regions"][0]["method"],"table_ocr")
        self.assertTrue(any(b["kind"]=="table_cell" and b["raw_text"]=="" for b in page["blocks"]))
        self.assertTrue(all(b["region_id"]==page["regions"][0]["id"] for b in page["blocks"]))

    def test_hybrid_table_receives_selected_lines_and_preserves_global_alternatives(self):
        doc=pymupdf.open(); page=doc.new_page(width=300,height=200)
        page.insert_text((60,60),"NATIVE -12.5")
        raw_box=page.get_text("dict")["blocks"][0]["lines"][0]["bbox"]
        page_box=[raw_box[0]/300,raw_box[1]/200,raw_box[2]/300,raw_box[3]/200]
        owner_box=[.1,.1,.8,.8]
        local_box=[(page_box[0]-.1)/.7,(page_box[1]-.1)/.7,(page_box[2]-.1)/.7,(page_box[3]-.1)/.7]

        class ConflictingTableReader(RegionReader):
            def recognize_lines(self, image, polygons):
                self.recognized.extend(polygons)
                value=block("NATIVE 12.5",local_box,"ocr")
                value["confidence"]=.95
                return [value]

            def structure_region(self, image, lines):
                self.supplied_text=[item["raw_text"] for item in lines]
                return [block("NATIVE -12.5 NATIVE 12.5",local_box,"ocr",table_id="t1",
                              row=0,column=0,row_span=1,column_span=1),
                        block("NATIVE -12.5 NATIVE 12.5",[0,0,1,1],"ocr","ocr/table[1]/recognition-text")],[]

        # Force the recognition route with a separate uncovered detector crop;
        # the fake recognizer deliberately returns a conflicting native crop.
        reader=ConflictingTableReader([("table",owner_box,.99)],[[.1,.6,.7,.7]])
        result=self.run_pdf(doc,reader)
        parsed=result["pages"][0]
        self.assertEqual(reader.supplied_text,["NATIVE -12.5"])
        cells=[item for item in parsed["blocks"] if item["kind"]=="table_cell"]
        self.assertEqual(cells[0]["raw_text"],"NATIVE -12.5")
        self.assertTrue(cells[0]["include_in_main"])
        selected=[item for item in parsed["blocks"] if item["include_in_main"]]
        self.assertEqual(selected,cells)
        wrong=[part for part in cells[0]["provenance"]["fragments"] if part["raw_text"]=="NATIVE 12.5"]
        self.assertEqual(len(wrong),1)
        self.assertLess(max(abs(a-b) for a,b in zip(wrong[0]["bbox"],page_box)),.001)
        self.assertIn("NATIVE 12.5",result["raw_text"])

    def test_cropbox_four_rotations_rerender_matches_source_pixels(self):
        import numpy as np
        for angle in (0,90,180,270):
            doc=pymupdf.open(); page=doc.new_page(width=500,height=400)
            page.draw_rect((120,100,180,140),fill=(0,0,0),color=(0,0,0))
            page.set_cropbox(pymupdf.Rect(80,60,360,280));page.set_rotation(angle)
            visible=pymupdf.Rect(120,100,180,140)
            # Drawing coordinates before CropBox differ by its translation.
            visible=pymupdf.Rect(visible.x0-80,visible.y0-60,visible.x1-80,visible.y1-60)
            visible=visible*page.rotation_matrix
            box=[visible.x0/page.rect.width,visible.y0/page.rect.height,visible.x1/page.rect.width,visible.y1/page.rect.height]
            crop,mapped=render_region(page,{"bbox":box,"reasons":[]},self.settings)
            self.assertGreater(float((np.asarray(crop.convert("L"))<100).mean()),.95)
            self.assertLess(max(abs(a-b) for a,b in zip(box,mapped)),.01)


if __name__ == "__main__":
    unittest.main()
