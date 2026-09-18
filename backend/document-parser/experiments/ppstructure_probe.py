"""Isolated PP-StructureV3 experiment; never imported by the production parser.

Bootstrap downloads models without accepting documents. Run blocks Python network
connections before importing Paddle and executes one image in a killable child.
Source images, model files and all extracted content must stay outside the repo.
"""
from __future__ import annotations

import argparse
import hashlib
import html
from html.parser import HTMLParser
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import time
import traceback

MODELS = {
    "layout_detection": "PP-DocLayout_plus-L",
    "doc_orientation_classify": "PP-LCNet_x1_0_doc_ori",
    "text_detection": "PP-OCRv5_mobile_det",
    "text_recognition": "eslav_PP-OCRv5_mobile_rec",
    "table_classification": "PP-LCNet_x1_0_table_cls",
    "wired_table_structure_recognition": "SLANeXt_wired",
    "wireless_table_structure_recognition": "SLANet_plus",
    "wired_table_cells_detection": "RT-DETR-L_wired_table_cell_det",
    "wireless_table_cells_detection": "RT-DETR-L_wireless_table_cell_det",
    "table_orientation_classify": "PP-LCNet_x1_0_doc_ori",
}
ASSETS = ("inference.json", "inference.pdiparams", "inference.yml")
REPO = Path(__file__).resolve().parents[3]


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(part)
    return result.hexdigest()


def outside_repo(path):
    path = Path(path).resolve()
    if path == REPO or REPO in path.parents:
        raise ValueError("Private experiment files must be outside the Git repository")
    return path


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def environment(root, offline):
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(root / "download-cache")
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[key] = "2"
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        def denied(*args, **kwargs):
            raise OSError("Experiment inference is offline: network connections are disabled")
        socket.socket.connect = denied
        socket.socket.connect_ex = denied
        socket.create_connection = denied
        def audit(event, args):
            if event in ("socket.connect", "socket.getaddrinfo", "socket.gethostbyname"):
                denied()
        sys.addaudithook(audit)
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)


def bootstrap(args):
    root = outside_repo(args.root)
    root.mkdir(parents=True, exist_ok=True)
    environment(root, False)
    model_root = root / "models"
    model_root.mkdir(exist_ok=True)
    from paddlex.inference.utils.official_models import official_models
    names = set(MODELS.values())
    if args.server_detector:
        names.add("PP-OCRv5_server_det")
    for model in sorted(names):
        destination = model_root / model
        if all((destination / name).is_file() for name in ASSETS):
            print(f"Model already installed: {model}", flush=True)
            continue
        existing = Path(args.reuse) / model if args.reuse else None
        if existing and all((existing / name).is_file() for name in ASSETS):
            source = existing
        else:
            print(f"Downloading official model: {model}", flush=True)
            source = Path(official_models[model])
        destination.mkdir(exist_ok=True)
        for name in ASSETS:
            shutil.copyfile(source / name, destination / name)
        print(f"Installed: {model}", flush=True)
    assets = {f"{model}/{name}": digest(model_root / model / name)
              for model in sorted(names) for name in ASSETS}
    lock_path = Path(__file__).with_name("model-lock.json")
    if lock_path.exists():
        locked = json.loads(lock_path.read_text(encoding="utf-8"))
        for key, value in assets.items():
            if key in locked and locked[key] != value:
                raise ValueError(f"Official model changed from pinned asset: {key}")
    write_json(root / "model-manifest.json", assets)
    print(f"Bootstrap complete: {len(assets)} hashed assets; no document inputs", flush=True)


class SafeTable(HTMLParser):
    """Whitelist table markup; never render arbitrary model-produced HTML."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.rows = []
        self.row = None
        self.cell = None
        self.suppressed = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "iframe", "object", "svg", "math"):
            self.suppressed += 1
        if self.suppressed:
            return
        if tag not in ("table", "tr", "td", "th"):
            return
        spans = {name: str(int(value)) for name, value in attrs
                 if tag in ("td", "th") and name in ("rowspan", "colspan")
                 and value and value.isdecimal() and 1 <= int(value) <= 1000}
        self.parts.append("<" + tag + "".join(f' {k}="{v}"' for k, v in spans.items()) + ">")
        if tag == "tr":
            self.row = []
            self.rows.append(self.row)
        if tag in ("td", "th"):
            self.cell = {"text": "", "rowspan": int(spans.get("rowspan", 1)), "colspan": int(spans.get("colspan", 1))}
            if self.row is not None:
                self.row.append(self.cell)

    def handle_endtag(self, tag):
        if self.suppressed:
            if tag in ("script", "style", "iframe", "object", "svg", "math"):
                self.suppressed -= 1
            return
        if tag in ("table", "tr", "td", "th"):
            self.parts.append(f"</{tag}>")
        if tag in ("td", "th"):
            self.cell = None
        if tag == "tr":
            self.row = None

    def handle_data(self, data):
        if self.cell is not None and not self.suppressed:
            self.cell["text"] += data
            self.parts.append(html.escape(data))


def constrain_cpu():
    """Limit native execution to two logical CPUs, in addition to thread settings."""
    if os.name == "nt":
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.GetProcessAffinityMask.argtypes = (ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t))
        kernel.SetProcessAffinityMask.argtypes = (ctypes.c_void_p, ctypes.c_size_t)
        process_mask, system_mask = ctypes.c_size_t(), ctypes.c_size_t()
        process = kernel.GetCurrentProcess()
        if not kernel.GetProcessAffinityMask(process, ctypes.byref(process_mask), ctypes.byref(system_mask)):
            raise ctypes.WinError(ctypes.get_last_error())
        selected = [1 << bit for bit in range(64) if process_mask.value & (1 << bit)][:2]
        mask = sum(selected)
        if not kernel.SetProcessAffinityMask(process, mask):
            raise ctypes.WinError(ctypes.get_last_error())
        return {"logical_cpu_mask": mask, "cpu_threads": 2}
    cpus = sorted(os.sched_getaffinity(0))[:2]
    os.sched_setaffinity(0, cpus)
    return {"logical_cpus": cpus, "cpu_threads": 2}


def pipeline_config(root, args):
    models = dict(MODELS)
    if args.server_detector:
        models["text_detection"] = "PP-OCRv5_server_det"
    config = {f"{key}_model_{suffix}": (name if suffix == "name" else str(root / "models" / name))
              for key, name in models.items() for suffix in ("name", "dir")}
    config.update(
        device="cpu", cpu_threads=2, enable_mkldnn=False,
        use_doc_orientation_classify=True, use_doc_unwarping=False,
        use_textline_orientation=False, use_table_recognition=True,
        use_formula_recognition=False, use_chart_recognition=False,
        use_seal_recognition=False, use_region_detection=False,
        text_det_limit_type="max", text_det_limit_side_len=args.det_limit,
        text_recognition_batch_size=1, text_rec_score_thresh=0.0,
        format_block_content=False, markdown_ignore_labels=[],
    )
    return config


def verified_assets(root, names):
    manifest = json.loads((root / "model-manifest.json").read_text(encoding="utf-8"))
    locked = json.loads(Path(__file__).with_name("model-lock.json").read_text(encoding="utf-8"))
    required = {f"{model}/{name}" for model in names for name in ASSETS}
    if not required <= manifest.keys() or not required <= locked.keys():
        raise ValueError("Every selected model asset must be present in the manifest and reviewed model-lock.json")
    actual = {key: digest(root / "models" / key) for key in sorted(required)}
    if any(actual[key] != manifest[key] or actual[key] != locked[key] for key in required):
        raise ValueError("Experiment model manifest/pinned lock mismatch")
    return actual


def worker(args):
    root, output = outside_repo(args.root), outside_repo(args.output)
    source = outside_repo(args.input)
    output.mkdir(parents=True, exist_ok=True)
    if any(path.name != "process.log" for path in output.iterdir()):
        raise ValueError("Worker output directory contains earlier results")
    if source.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Experiment input exceeds 64 MiB")
    source_code = Path(__file__).read_bytes()
    (output / "runner-source.py").write_bytes(source_code)
    environment(root, True)
    affinity = constrain_cpu()
    import cv2
    cv2.setNumThreads(2)
    names = set(MODELS.values()) if args.mode == "ppstructure" else {
        MODELS["text_detection"], MODELS["text_recognition"], MODELS["doc_orientation_classify"]}
    if args.server_detector:
        names.discard(MODELS["text_detection"])
        names.add("PP-OCRv5_server_det")
    assets = verified_assets(root, names)
    from PIL import Image
    with Image.open(source) as im:
        dimensions = list(im.size)
        if im.width * im.height > 32_000_000:
            raise ValueError("Experiment input exceeds 32 million pixels")
    packages = {dist.metadata["Name"]: dist.version for dist in importlib.metadata.distributions()}
    config = pipeline_config(root, args)
    metadata = {
        "mode": args.mode, "python": platform.python_version(), "platform": platform.platform(),
        "packages": dict(sorted(packages.items())), "script_sha256": hashlib.sha256(source_code).hexdigest(),
        "models_sha256": assets, "input_sha256": digest(source), "input_dimensions": dimensions,
        "config": config if args.mode == "ppstructure" else {"implementation": "production LocalOCR", "det_limit": 1536},
        "network_policy": "Python socket connect/connect_ex/create_connection denied; audit hook denies network resolution/connect; local models; HF offline",
        "resources": {**affinity, "max_input_bytes": 64 * 1024 * 1024, "max_input_pixels": 32_000_000,
                      "rss_limit": None}, "status": "initializing",
    }
    write_json(output / "run.json", metadata)
    started = time.perf_counter()
    try:
        if args.mode == "ppstructure":
            from paddleocr import PPStructureV3
            from paddlex.inference import load_pipeline_config
            from paddlex.inference.utils.official_models import official_models
            def no_implicit_models(*args, **kwargs):
                raise RuntimeError("Offline experiment requires explicit verified local model directories")
            official_models.get_model_path = no_implicit_models
            base_config = load_pipeline_config("PP-StructureV3")
            # PaddleOCR 3.7's public flag updates main OCR only. Its lazy table
            # OCR would otherwise enable text-line orientation and download it.
            base_config["SubPipelines"]["TableRecognition"]["SubPipelines"]["GeneralOCR"]["use_textline_orientation"] = False
            metadata["paddlex_overrides"] = {"SubPipelines.TableRecognition.SubPipelines.GeneralOCR.use_textline_orientation": False}
            engine = PPStructureV3(**config, paddlex_config=base_config)
            engine.export_paddlex_config_to_yaml(str(output / "resolved-pipeline.yaml"))
        else:
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from ocr import LocalOCR
            from types import SimpleNamespace
            engine = LocalOCR(SimpleNamespace(models=root / "models", cpu_threads=2))
            metadata["baseline_sources_sha256"] = {name: digest(Path(__file__).resolve().parents[1] / name)
                                                   for name in ("ocr.py", "config.py", "common.py")}
        metadata["initialization_seconds"] = time.perf_counter() - started
        metadata["status"] = "predicting"
        write_json(output / "run.json", metadata)
        started = time.perf_counter()
        if args.mode == "ppstructure":
            predict_config = {
                "use_wired_table_cells_trans_to_html": False,
                "use_wireless_table_cells_trans_to_html": False,
                "use_table_orientation_classify": True,
                "use_ocr_results_with_table_cells": True,
                "use_e2e_wired_table_rec_model": False,
                "use_e2e_wireless_table_rec_model": True,
            }
            results = list(engine.predict(str(source), **predict_config))
            metadata["predict_config"] = predict_config
            metadata["prediction_seconds"] = time.perf_counter() - started
            if len(results) != 1:
                raise ValueError(f"Expected one page; got {len(results)}")
            result = results[0]
            data = result.json
            write_json(output / "result.json", data)
            data = data.get("res", data)
            (output / "text.txt").write_text("\n".join(data["overall_ocr_res"]["rec_texts"]) + "\n", encoding="utf-8")
            ordered_blocks = []
            for item in data["parsing_res_list"]:
                content = item["block_content"]
                if item["block_label"] == "table":
                    table = SafeTable()
                    table.feed(content)
                    content = "\n".join("\t".join(cell["text"] for cell in row) for row in table.rows)
                ordered_blocks.append(f'[{item["block_label"]}; block_id={item["block_id"]}; order={item["block_order"]}]\n{content}')
            (output / "layout-text.txt").write_text("\n\n".join(ordered_blocks) + "\n", encoding="utf-8")
            tables = []
            for index, raw_html in enumerate(result.html.values()):
                safe = SafeTable()
                safe.feed(raw_html)
                (output / f"table-{index + 1}.html").write_text("".join(safe.parts), encoding="utf-8")
                (output / f"table-{index + 1}.txt").write_text("\n".join("\t".join(cell["text"] for cell in row) for row in safe.rows) + "\n", encoding="utf-8")
                tables.append({"index": index + 1, "rows": safe.rows})
            write_json(output / "tables.json", tables)
            metadata["tables"] = len(tables)
            metadata["table_cells"] = sum(len(row) for table in tables for row in table["rows"])
            metadata["ocr_lines"] = len(data["overall_ocr_res"]["rec_texts"])
        else:
            with Image.open(source) as image:
                blocks, angle, detected = engine.recognize(image)
            metadata["prediction_seconds"] = time.perf_counter() - started
            write_json(output / "result.json", {"blocks": blocks, "orientation_ccw": angle, "detected_polygons": detected})
            (output / "text.txt").write_text("\n".join(block["raw_text"] for block in blocks) + "\n", encoding="utf-8")
            metadata["ocr_lines"] = len(blocks)
        metadata["status"] = "complete"
    except BaseException as error:
        metadata["status"] = "failed"
        metadata["error"] = f"{type(error).__name__}: {error}"
        metadata["traceback"] = traceback.format_exc()
        raise
    finally:
        import psutil
        memory = psutil.Process().memory_info()
        metadata["memory_at_finish"] = {"rss_bytes": memory.rss, "peak_working_set_bytes": getattr(memory, "peak_wset", None)}
        write_json(output / "run.json", metadata)


def execute_bounded(command, output, timeout):
    started = time.perf_counter()
    with (output / "process.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        try:
            code = process.wait(timeout=timeout)
            status = "complete" if code == 0 else "failed"
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            code, status = process.returncode, "timeout-killed"
    write_json(output / "supervisor.json", {"status": status, "exit_code": code,
               "wall_seconds": time.perf_counter() - started, "timeout_seconds": timeout})
    return status, code


def run(args):
    output = outside_repo(args.output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Refusing nonempty output directory; choose a new run directory")
    output.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, str(Path(__file__).resolve()), "worker", "--root", args.root,
               "--input", args.input, "--output", args.output, "--mode", args.mode,
               "--det-limit", str(args.det_limit)]
    if args.server_detector:
        command.append("--server-detector")
    status, code = execute_bounded(command, output, args.timeout)
    print(json.dumps({"output": str(output), "status": status, "exit_code": code}))
    if code:
        raise SystemExit(1)


def bounded_int(minimum, maximum):
    def validate(value):
        value = int(value)
        if not minimum <= value <= maximum:
            raise argparse.ArgumentTypeError(f"Value must be between {minimum} and {maximum}")
        return value
    return validate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    download = commands.add_parser("bootstrap")
    download.add_argument("--root", required=True)
    download.add_argument("--reuse", help="Existing official_models directory; verified by recorded hashes")
    download.add_argument("--server-detector", action="store_true")
    for name in ("run", "worker"):
        command = commands.add_parser(name)
        command.add_argument("--root", required=True)
        command.add_argument("--input", required=True)
        command.add_argument("--output", required=True)
        command.add_argument("--mode", choices=("ppstructure", "baseline"), default="ppstructure")
        command.add_argument("--det-limit", type=bounded_int(512, 4096), default=1536)
        command.add_argument("--server-detector", action="store_true")
        command.add_argument("--timeout", type=bounded_int(10, 1800), default=1200)
    args = parser.parse_args()
    if getattr(args, "mode", None) == "baseline" and (args.server_detector or args.det_limit != 1536):
        parser.error("Baseline uses unchanged production LocalOCR (mobile detector, limit 1536)")
    {"bootstrap": bootstrap, "run": run, "worker": worker}[args.command](args)


if __name__ == "__main__":
    main()
