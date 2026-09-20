"""Explicit online bootstrap, run without source-document mounts. Runtime never downloads."""
import hashlib
import json
import os
import shutil
from pathlib import Path

from config import MODELS, MODEL_FILES, verify_models


def main():
    target = Path(os.environ.get("PARSER_MODEL_ROOT", "/models"))
    cache = target / ".download-cache"
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(cache)
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    os.environ.pop("HF_HUB_OFFLINE", None)
    from paddlex.inference.utils.official_models import official_models
    manifest = {}
    for model in MODELS:
        (target / model).mkdir(parents=True, exist_ok=True)
        if all((target / model / name).is_file() for name in MODEL_FILES):
            source_root = target / model
        else:
            source_root = Path(official_models[model])
        for name in MODEL_FILES:
            source = source_root / name
            destination = target / model / name
            if source.resolve() != destination.resolve():
                shutil.copyfile(source, destination)
            manifest[f"{model}/{name}"] = hashlib.sha256(destination.read_bytes()).hexdigest()
    verify_models(target)
    (target / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print("Models installed; runtime verifies asset hashes and loads models before readiness.")


if __name__ == "__main__":
    main()
