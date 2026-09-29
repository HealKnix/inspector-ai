"""Explicit runtime bounds, model assets and reproducibility fingerprint."""
import hashlib
import json
import os
import platform
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

MODEL_ROLES = {
    "text_detection": "PP-OCRv5_mobile_det", "text_recognition": "eslav_PP-OCRv5_mobile_rec",
    "doc_orientation_classify": "PP-LCNet_x1_0_doc_ori", "layout_detection": "PP-DocLayout_plus-L",
    "table_classification": "PP-LCNet_x1_0_table_cls",
    "wired_table_structure_recognition": "SLANeXt_wired", "wireless_table_structure_recognition": "SLANet_plus",
    "wired_table_cells_detection": "RT-DETR-L_wired_table_cell_det",
    "wireless_table_cells_detection": "RT-DETR-L_wireless_table_cell_det",
    "table_orientation_classify": "PP-LCNet_x1_0_doc_ori",
}
MODELS = tuple(dict.fromkeys(MODEL_ROLES.values()))
MODEL_FILES = ("inference.json", "inference.pdiparams", "inference.yml")
OCR_OPTIONS = {
    "use_doc_orientation_classify": True, "use_doc_unwarping": False,
    "use_textline_orientation": False, "use_table_recognition": True,
    "use_formula_recognition": False, "use_chart_recognition": False,
    "use_seal_recognition": False, "use_region_detection": False,
    "text_det_limit_type": "max", "text_det_limit_side_len": 1536,
    "text_recognition_batch_size": 1, "text_rec_score_thresh": 0.0,
    "format_block_content": False, "markdown_ignore_labels": [],
}
PREDICT_OPTIONS = {
    "use_wired_table_cells_trans_to_html": False, "use_wireless_table_cells_trans_to_html": False,
    "use_table_orientation_classify": True, "use_ocr_results_with_table_cells": True,
    "use_e2e_wired_table_rec_model": False, "use_e2e_wireless_table_rec_model": True,
}

# Routing policy, not a claim of OCR accuracy. Included in every fingerprint.
REGION_OPTIONS = {"native_line_coverage": .90, "native_tolerance_pixels": 2,
                  "native_coverage_measure": "foreground-ink-v1", "foreground_threshold": 180,
                  "detector_padding_pixels": 16,
                  "layout_min_score": .50, "conflict_overlap": .15,
                  "layout_profile": "PP-DocLayout_plus-L-original-v1"}


def verify_models(root):
    expected = json.loads((Path(__file__).parent / "model-lock.json").read_text(encoding="utf-8"))
    assets = {f"{model}/{name}": digest_file(root / model / name)
              for model in MODELS for name in MODEL_FILES}
    if assets != expected:
        raise ValueError("OCR model assets do not match model-lock.json")
    return assets


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def integer(name, default, minimum, maximum):
    value = int(os.environ.get(name, default))
    if not minimum <= value <= maximum:
        raise ValueError(f"Invalid configuration: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    storage: Path
    models: Path
    font: Path
    timeout: int = 600
    max_pages: int = 500
    max_pixels: int = 20_000_000
    max_bytes: int = 104_857_600
    max_xml_bytes: int = 52_428_800
    max_blocks: int = 100_000
    cpu_threads: int = 2
    render_dpi: int = 200
    max_output_bytes: int = 52_428_800

    @classmethod
    def environment(cls):
        return cls(
            Path(os.environ.get("STORAGE_ROOT", "/data")).resolve(),
            Path(os.environ.get("PARSER_MODEL_ROOT", "/models")).resolve(),
            Path(os.environ.get("PARSER_FONT_PATH", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")).resolve(),
            integer("PARSER_FILE_TIMEOUT_SECONDS", 600, 1, 86400),
            integer("PARSER_MAX_PAGES", 500, 1, 10000),
            integer("PARSER_MAX_RENDER_PIXELS", 20_000_000, 100000, 80000000),
            integer("PARSER_MAX_FILE_BYTES", 104857600, 1, 1073741824),
            integer("PARSER_MAX_XML_BYTES", 52428800, 1, 104857600),
            integer("PARSER_MAX_BLOCKS", 100000, 1, 1000000),
            integer("PARSER_CPU_THREADS", 2, 1, 16),
            integer("PARSER_RENDER_DPI", 200, 72, 400),
            integer("PARSER_MAX_OUTPUT_BYTES", 52428800, 1024, 268435456),
        )

    def versions(self):
        assets = verify_models(self.models)
        # Hash executable source too, so an implementation change cannot reuse stale output.
        sources = {p.name: digest_file(p) for p in sorted(Path(__file__).parent.glob("*.py"))}
        return {
            "parser": "par-local-2", "normalization": "nfc-horizontal-space-v1",
            "renderer": "pymupdf-pillow-semantic-v1", "table_detector": "pp-structure-v3-guarded-v2",
            "ocr_engine": "PP-StructureV3",
            "pdf_region_profile": "paddle-regions-v2",
            "text_provenance": "par-text-provenance-v1",
            "pdf_region_config": hashlib.sha256(json.dumps(REGION_OPTIONS, sort_keys=True).encode()).hexdigest(),
            "ocr_profile": "mobile1536-eslav-cpu-mkldnn-off-v1",
            "ocr_config": hashlib.sha256(json.dumps({"models": MODEL_ROLES, "init": OCR_OPTIONS, "predict": PREDICT_OPTIONS,
                                      "table_textline_orientation": False}, sort_keys=True).encode()).hexdigest(),
            "python": platform.python_version(),
            **{p: version(p) for p in ("pymupdf", "paddleocr", "paddlepaddle", "paddlex", "pillow", "numpy", "opencv-contrib-python")},
            "models_sha256": hashlib.sha256(json.dumps(assets, sort_keys=True).encode()).hexdigest(),
            "font_sha256": digest_file(self.font),
            "source_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
            "dependency_lock_sha256": digest_file(Path(__file__).parent / "requirements.lock.txt"),
            "config": json.dumps({k: v for k, v in self.__dict__.items() if not isinstance(v, Path)}, sort_keys=True, separators=(",", ":")),
        }


def fingerprint(versions):
    return hashlib.sha256(json.dumps(versions, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
