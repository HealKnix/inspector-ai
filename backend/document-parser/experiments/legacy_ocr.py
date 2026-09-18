"""Local orientation classification + OCR; original viewer pixels stay unchanged."""
import os

from common import bbox_pixels, block
MODELS = ("PP-OCRv5_mobile_det", "eslav_PP-OCRv5_mobile_rec", "PP-LCNet_x1_0_doc_ori")


class LocalOCR:
    def __init__(self, settings):
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["OMP_NUM_THREADS"] = str(settings.cpu_threads)
        os.environ["OPENBLAS_NUM_THREADS"] = str(settings.cpu_threads)
        os.environ["MKL_NUM_THREADS"] = str(settings.cpu_threads)
        import cv2
        cv2.setNumThreads(settings.cpu_threads)
        from paddleocr import PaddleOCR, DocImgOrientationClassification
        self.orientation = DocImgOrientationClassification(
            model_name=MODELS[2], model_dir=str(settings.models / MODELS[2]), topk=4,
            device="cpu", cpu_threads=settings.cpu_threads, enable_mkldnn=False)
        self.engine = PaddleOCR(
            text_detection_model_name=MODELS[0], text_detection_model_dir=str(settings.models / MODELS[0]),
            text_recognition_model_name=MODELS[1], text_recognition_model_dir=str(settings.models / MODELS[1]),
            use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
            device="cpu", cpu_threads=settings.cpu_threads, enable_mkldnn=False,
            text_det_limit_type="max", text_det_limit_side_len=1536,
            text_recognition_batch_size=1, text_rec_score_thresh=0.0,
        )

    def recognize(self, image):
        import numpy as np
        original = np.array(image.convert("RGB"))[:, :, ::-1]
        orientation = list(self.orientation.predict(np.ascontiguousarray(original)))[0].json
        orientation = orientation.get("res", orientation)
        labels, scores = orientation["label_names"], orientation["scores"]
        self.orientation_score = float(scores[0])
        self.orientation_ambiguous = self.orientation_score < .75 or self.orientation_score - float(scores[1]) < .25
        # These are bounded execution heuristics, not accuracy claims. Uncertain
        # orientation compares two candidates while the page remains LOW_QUALITY.
        orientations = [int(label) // 90 for label in labels[:2 if self.orientation_ambiguous else 1]]
        candidates = []
        for turns in orientations:
            # np.rot90 is counterclockwise; polygon coordinates are inverted below.
            pixels = np.ascontiguousarray(np.rot90(original, turns))
            result = list(self.engine.predict(pixels))[0]
            data = result.json
            data = data.get("res", data)
            texts = data["rec_texts"]
            scores = data["rec_scores"]
            score = sum(min(len(text), 80) * float(conf) ** 3 for text, conf in zip(texts, scores))
            candidates.append((score, turns, data))
        _, turns, data = max(candidates, key=lambda item: item[0])
        blocks = []
        for text, score, polygon in zip(data["rec_texts"], data["rec_scores"], data["rec_polys"]):
            points = [unrotate_point(float(x), float(y), turns, image.width, image.height) for x, y in polygon]
            xs, ys = zip(*points)
            item = block(text, bbox_pixels((min(xs), min(ys), max(xs), max(ys)), image.width, image.height), "ocr")
            item["confidence"] = max(0.0, min(1.0, float(score)))
            blocks.append(item)
        return blocks, turns * 90, len(data.get("dt_polys", []))


def unrotate_point(x, y, turns, width, height):
    if turns == 1:
        return width - y, x
    if turns == 2:
        return width - x, height - y
    if turns == 3:
        return y, height - x
    return x, y
