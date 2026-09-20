"""Frozen layout-only probe. No OCR, downloads, or adaptive production routing.

All inputs/truth/results stay outside Git. The parent verifies the predeclared
manifest before starting a single reusable LayoutDetection predictor. Windows
uses a 4 GiB Job Object; Linux requires an existing <=4 GiB cgroup memory limit.
"""
from __future__ import annotations

import argparse
import ctypes
import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from ppstructure_probe import ASSETS, digest, environment, outside_repo, write_json

MODEL = "PP-DocLayout_plus-L"
MAX_MEMORY = 4 * 1024 ** 3
MAX_PIXELS, MAX_INPUT_BYTES = 20_000_000, 100 * 1024 ** 2
# Exact LayoutDetection subsection of the pinned PP-StructureV3 3.7.2 config.
# No thresholds are inferred from truth or adjusted during a run.
BASELINE = {
    "threshold": {i: {0: .3, 2: .4, 7: .3, 15: .45}.get(i, .5) for i in range(20)},
    "layout_nms": True,
    "layout_unclip_ratio": [1.0, 1.0],
    "layout_merge_bboxes_mode": {i: "large" if i in (0, 1, 7, 16) else "union" for i in range(20)},
}
LABELS = ["paragraph_title", "image", "text", "number", "abstract", "content", "figure_title", "formula",
          "table", "reference", "doc_title", "footnote", "header", "algorithm", "footer", "seal", "chart",
          "formula_number", "aside_text", "reference_content"]


def checked_file(path, expected_hash):
    path = outside_repo(path)
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
        raise ValueError("Manifest requires an explicit SHA256")
    if not path.is_file() or path.stat().st_size > MAX_INPUT_BYTES or digest(path) != expected_hash:
        raise ValueError("Manifest file hash/size mismatch")
    return path


def validate_manifest(path):
    from PIL import Image
    path = outside_repo(path)
    if path.stat().st_size > 1024 * 1024:
        raise ValueError("Manifest exceeds 1 MiB")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ValueError("Unsupported manifest version")
    checked_file(manifest["truth_path"], manifest["truth_sha256"])
    pages = manifest["pages"]
    if not isinstance(pages, list) or not 1 <= len(pages) <= 100:
        raise ValueError("Manifest must contain 1..100 pages")
    identifiers = set()
    for page in pages:
        identifier = page["id"]
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identifier) or identifier in identifiers:
            raise ValueError("Invalid or repeated page id")
        identifiers.add(identifier)
        if page["split"] not in ("development", "holdout") or type(page["page_number"]) is not int or page["page_number"] < 1:
            raise ValueError("Invalid split/page number")
        if not re.fullmatch(r"[a-f0-9]{64}", page["source_sha256"]):
            raise ValueError("Missing original source SHA256")
        image_path = checked_file(page["image_path"], page["image_sha256"])
        with Image.open(image_path) as image:
            if image.format != "PNG" or not 0 < image.width * image.height <= MAX_PIXELS:
                raise ValueError("Inputs must be PNG with at most 20M pixels")
            image.verify()
    return manifest


def model_assets(models):
    models = outside_repo(models)
    lock = json.loads((Path(__file__).parent.parent / "model-lock.json").read_text(encoding="utf-8"))
    actual = {f"{MODEL}/{name}": digest(models / MODEL / name) for name in ASSETS}
    if any(lock.get(key) != value for key, value in actual.items()):
        raise ValueError("Layout model does not match pinned production asset hashes")
    return actual


def create_engine(models):
    # Only this standalone wrapper is imported. PPStructureV3/PaddleOCR.predict
    # and document orientation/recognition models are never called by this probe.
    from paddleocr import LayoutDetection
    from paddlex.inference.utils.official_models import official_models
    def denied(*_args, **_kwargs):
        raise RuntimeError("Layout probe requires existing pinned local model files")
    official_models.get_model_path = denied
    return LayoutDetection(model_name=MODEL, model_dir=str(Path(models) / MODEL),
                           device="cpu", cpu_threads=2, enable_mkldnn=False, **BASELINE)


def infer_page(engine, page, output):
    import numpy as np
    from PIL import Image, ImageDraw
    with Image.open(page["image_path"]) as source:
        image = source.convert("RGB")
    pixels = np.ascontiguousarray(np.array(image)[:, :, ::-1])
    started = time.perf_counter()
    results = engine.predict(pixels)
    seconds = time.perf_counter() - started
    if len(results) != 1:
        raise ValueError("Expected one layout result per original page")
    raw = results[0].json
    data = raw.get("res", raw)
    write_json(output / f'{page["id"]}.raw.json', raw)
    boxes = data["boxes"]
    overlay = ImageDraw.Draw(image)
    for index, box in enumerate(boxes):
        a, b, c, d = box["coordinate"]
        overlay.rectangle((a, b, c, d), outline="red", width=3)
        overlay.text((max(0, a), max(0, b)), f'{index + 1}: {box["label"]} {box["score"]:.3f}', fill="red")
    image.save(output / f'{page["id"]}.overlay.png')
    evidence = {**page, "width": image.width, "height": image.height,
                "coordinate_space": "original-render-pixels", "orientation_applied": 0,
                "prediction_seconds": seconds, "boxes": boxes}
    write_json(output / f'{page["id"]}.json', evidence)
    return {"id": page["id"], "prediction_seconds": seconds, "boxes": len(boxes)}


class WindowsMemoryJob:
    """Kernel memory cap, attached while worker waits for the parent's stdin gate."""
    def __init__(self, process, limit):
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64), ("flags", w.DWORD),
                        ("minimum_ws", ctypes.c_size_t), ("maximum_ws", ctypes.c_size_t), ("active", w.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(f"counter{i}", ctypes.c_uint64) for i in range(6)]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("process_memory", ctypes.c_size_t),
                        ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = w.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x100 | 0x2000  # PROCESS_MEMORY | KILL_ON_JOB_CLOSE
        limits.process_memory = limit
        if not self.handle or not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise ctypes.WinError(ctypes.get_last_error())
        if not self.kernel.AssignProcessToJobObject(self.handle, w.HANDLE(int(process._handle))):
            self.close()
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def linux_memory_limit():
    for path in (Path("/sys/fs/cgroup/memory.max"), Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")):
        if path.is_file():
            value = path.read_text().strip()
            if value.isdigit() and 0 < int(value) <= MAX_MEMORY:
                return int(value)
    raise ValueError("Linux layout probe requires a Docker/cgroup memory limit <=4 GiB")


def execute_bounded(command, output, timeout, memory_limit=MAX_MEMORY):
    import psutil
    if os.name != "nt":
        linux_memory_limit()
    started, peak_rss, job = time.perf_counter(), 0, None
    status, code = "failed", None
    with (output / "process.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
        try:
            child = psutil.Process(process.pid)
            cpus = psutil.Process().cpu_affinity()[:2]
            if len(cpus) < 2:
                raise ValueError("Layout benchmark needs two available CPUs")
            child.cpu_affinity(cpus)
            if os.name == "nt":
                job = WindowsMemoryJob(process, memory_limit)
            process.stdin.write("RUN\n")
            process.stdin.flush()
            process.stdin.close()
            while process.poll() is None:
                try:
                    peak_rss = max(peak_rss, child.memory_info().rss)
                except psutil.NoSuchProcess:
                    break
                if peak_rss > memory_limit:
                    status = "resource-aborted"
                    break
                if time.perf_counter() - started > timeout:
                    status = "timeout-killed"
                    break
                time.sleep(.1)
            if process.poll() is None:
                process.kill()
            code = process.wait()
            if status == "failed" and code == 0:
                status = "complete"
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            if job:
                job.close()
            write_json(output / "supervisor.json", {"status": status, "exit_code": code,
                "wall_seconds": time.perf_counter() - started, "timeout_seconds": timeout,
                "memory_limit_bytes": memory_limit, "memory_limit_kind": "windows-job-process-commit" if os.name == "nt" else "cgroup",
                "observed_peak_rss_bytes": peak_rss, "rss_sample_interval_seconds": .1, "cpu_count": 2})
    return status, code


def worker(args):
    if sys.stdin.readline().strip() != "RUN":
        raise ValueError("Worker must be started by the bounded supervisor")
    output = outside_repo(args.output)
    environment(output, True)
    manifest = validate_manifest(args.manifest)
    assets = model_assets(args.models)
    metadata = {"status": "running", "engine": "LayoutDetection", "model": MODEL, "baseline": BASELINE,
        "labels": LABELS, "model_assets": assets, "manifest_sha256": digest(args.manifest),
        "truth_sha256": manifest["truth_sha256"], "runner_sha256": digest(__file__),
        "versions": {p: importlib.metadata.version(p) for p in ("paddleocr", "paddlex", "paddlepaddle", "numpy", "pillow")},
        "input_policy": "original PNG pixels; no orientation/masking/OCR; truth never used by predictor", "pages": []}
    write_json(output / "run.json", metadata)
    engine = None
    try:
        started = time.perf_counter()
        engine = create_engine(args.models)
        metadata["initialization_seconds"] = time.perf_counter() - started
        for page in manifest["pages"]:
            # Hash again immediately before prediction; corpus cannot silently
            # change between parent preflight and this worker's current page.
            checked_file(page["image_path"], page["image_sha256"])
            metadata["pages"].append(infer_page(engine, page, output))
            write_json(output / "run.json", metadata)
        metadata["status"] = "complete"
    except BaseException as error:
        metadata["status"], metadata["error_type"] = "failed", type(error).__name__
        raise
    finally:
        if engine:
            engine.close()
        write_json(output / "run.json", metadata)


def run(args):
    manifest = validate_manifest(args.manifest)
    model_assets(args.models)
    output = outside_repo(args.output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Refusing nonempty output directory")
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "manifest.json", manifest)
    command = [sys.executable, "-B", str(Path(__file__).resolve()), "worker", "--manifest", str(output / "manifest.json"),
               "--models", str(Path(args.models).resolve()), "--output", str(output), "--timeout", str(args.timeout)]
    status, code = execute_bounded(command, output, args.timeout)
    print(json.dumps({"status": status, "exit_code": code, "output": str(output)}))
    if status != "complete":
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "worker"))
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800:
        parser.error("timeout must be 1..1800 seconds for the whole manifest")
    {"run": run, "worker": worker}[args.command](args)


if __name__ == "__main__":
    main()
