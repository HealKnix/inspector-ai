"""Reusable offline PP-StructureV3; displayed source pixels remain unchanged."""
import os

from config import MODEL_ROLES, OCR_OPTIONS, PREDICT_OPTIONS
from pp_structure import convert_result, unrotate_point


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
