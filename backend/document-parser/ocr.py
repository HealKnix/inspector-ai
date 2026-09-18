"""Reusable offline PP-StructureV3; displayed source pixels remain unchanged."""
import os
from importlib.metadata import version

from config import MODEL_ROLES, OCR_OPTIONS, PREDICT_OPTIONS, REGION_OPTIONS
from pp_structure import convert_result, unrotate_point
from common import block, bbox_pixels, normalize


class LocalOCR:
    def __init__(self, settings):
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        os.environ["HF_HUB_OFFLINE"] = "1"
        for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
            os.environ[name] = str(settings.cpu_threads)
        import cv2
        cv2.setNumThreads(settings.cpu_threads)
        from paddleocr import PPStructureV3
        from paddlex.inference import load_pipeline_config
        from paddlex.inference.utils.official_models import official_models

        def no_downloads(*_args, **_kwargs):
            raise RuntimeError("Offline parser requires explicit local model paths")
        official_models.get_model_path = no_downloads
        config = load_pipeline_config("PP-StructureV3")
        # Public flag does not affect the lazy table OCR in PaddleOCR 3.7.
        table_ocr = config["SubPipelines"]["TableRecognition"]["SubPipelines"]["GeneralOCR"]
        table_ocr["use_textline_orientation"] = False
        models = {f"{role}_model_{suffix}": model if suffix == "name" else str(settings.models / model)
                  for role, model in MODEL_ROLES.items() for suffix in ("name", "dir")}
        self.engine = PPStructureV3(**models, **OCR_OPTIONS, paddlex_config=config,
                                   device="cpu", cpu_threads=settings.cpu_threads, enable_mkldnn=False)
        # The component adapter below is deliberately tied to this audited API.
        if (version("paddleocr"), version("paddlex")) != ("3.7.0", "3.7.2"):
            raise RuntimeError("Unsupported regional Paddle adapter version")
        self.components = self.engine.paddlex_pipeline
        self.general = self.components.general_ocr_pipeline
        self.reasons = []
        self.orientation_score = None
        self.orientation_ambiguous = False

    def recognize(self, image):
        import numpy as np
        pixels = np.ascontiguousarray(np.array(image.convert("RGB"))[:, :, ::-1])
        result = list(self.engine.predict(pixels, **PREDICT_OPTIONS))[0]
        data = result.json
        data = data.get("res", data)
        blocks, angle, detected, self.reasons = convert_result(data, image.width, image.height)
        self.detected_without_text = detected > sum(bool(text.strip()) for text in data["overall_ocr_res"].get("rec_texts", []))
        return blocks, angle, detected

    @staticmethod
    def pixels(image):
        import numpy as np
        return np.ascontiguousarray(np.array(image.convert("RGB"))[:, :, ::-1])

    def layout(self, image):
        """Layout on original pixels; never the full document/OCR pipeline."""
        return list(self.components.layout_det_model(self.pixels(image)))[0]["boxes"]

    def detect_lines(self, image):
        import numpy as np
        from PIL import ImageOps
        padding = REGION_OPTIONS["detector_padding_pixels"]
        # Layout can return a tight single-line crop. The DB detector needs
        # whitespace context; padding is synthetic white, never adjacent pixels
        # from a skipped graphic, and does not change DPI or trigger retries.
        padded = ImageOps.expand(image, border=padding, fill="white")
        params = self.general.get_text_det_params()
        result = list(self.general.text_det_model(self.pixels(padded), **params))[0]
        polygons = []
        for polygon in result["dt_polys"]:
            points = np.asarray(polygon, dtype=float) - padding
            points[:, 0] = np.clip(points[:, 0], 0, image.width)
            points[:, 1] = np.clip(points[:, 1], 0, image.height)
            if np.ptp(points[:, 0]) > 0 and np.ptp(points[:, 1]) > 0:
                polygons.append(points.tolist())
        return polygons

    def recognize_lines(self, image, polygons):
        """Only the explicitly selected line crops reach the recognition model."""
        import numpy as np
        if not polygons:
            return []
        crops = list(self.general._crop_by_polys(self.pixels(image), np.asarray(polygons, dtype=np.float32)))
        results = []
        for polygon, crop in zip(polygons, crops):
            if crop.size == 0:
                continue
            prediction = list(self.general.text_rec_model([crop]))[0]
            text = prediction["rec_text"]
            if not normalize(text):
                continue
            xs, ys = zip(*polygon)
            item = block(text, bbox_pixels([min(xs), min(ys), max(xs), max(ys)], image.width, image.height), "ocr")
            item["confidence"] = max(0., min(1., float(prediction["rec_score"])))
            results.append(item)
        return results

    def structure_region(self, image, lines):
        """Table geometry consumes supplied readings, with all internal OCR off."""
        import numpy as np
        from paddlex.inference.pipelines.ocr.result import OCRResult
        boxes = np.asarray([[b[0] * image.width, b[1] * image.height, b[2] * image.width, b[3] * image.height]
                            for b in (item["bbox"] for item in lines)], dtype=np.float32).reshape((-1, 4))
        polys = np.asarray([[[a, b], [c, b], [c, d], [a, d]] for a, b, c, d in boxes], dtype=np.float32).reshape((-1, 4, 2))
        pixels = self.pixels(image)
        overall = OCRResult({"rec_boxes": boxes, "rec_polys": polys, "dt_polys": polys,
                             "doc_preprocessor_res": {"output_img": pixels},
                             "rec_texts": [item["raw_text"] for item in lines],
                             "rec_scores": [item["confidence"] if item["confidence"] is not None else 1. for item in lines]})
        result = list(self.components.table_recognition_pipeline.predict(
            pixels, use_doc_orientation_classify=False, use_doc_unwarping=False,
            use_layout_detection=False, use_ocr_model=False, overall_ocr_res=overall,
            use_table_orientation_classify=False, use_ocr_results_with_table_cells=False,
            use_e2e_wired_table_rec_model=False, use_e2e_wireless_table_rec_model=True,
            use_wired_table_cells_trans_to_html=False, use_wireless_table_cells_trans_to_html=False))[0]
        # Reuse the bounded, HTML-safe cell validation, but not its overall OCR
        # copy: source/native and selected OCR lines are already retained.
        data = {"width": image.width, "height": image.height, "overall_ocr_res": {"rec_texts": []},
                "table_res_list": result["table_res_list"]}
        cells, _angle, _detected, reasons = convert_result(data, image.width, image.height)
        return cells, reasons
