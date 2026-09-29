"""Read-only source-volume snapshot; hashes describe the archived bytes."""
import hashlib
import json
import sys
import tarfile
from pathlib import Path

name = sys.argv[1]
if name not in ("models", "clamav"):
    raise ValueError("Unsupported asset class")
root = Path("/source")
files = sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink()
               and not any(x.startswith(".") for x in p.relative_to(root).parts)
               and (name == "models" or p.suffix in (".cvd", ".cld")))
archive_path = Path("/out") / (name + ".tar")
with tarfile.open(archive_path, "w") as archive:
    for source in files:
        archive.add(source, arcname=source.relative_to(root).as_posix(), recursive=False)
manifest = {}
total = 0
with tarfile.open(archive_path) as archive:
    for member in archive.getmembers():
        result = hashlib.sha256()
        with archive.extractfile(member) as stream:
            for chunk in iter(lambda: stream.read(1048576), b""):
                result.update(chunk)
        manifest[member.name] = result.hexdigest()
        total += member.size
if name == "models":
    locked = json.loads(Path("/app/model-lock.json").read_text())
    if any(manifest.get(key) != value for key, value in locked.items()):
        raise ValueError("Model snapshot differs from release model-lock.json")
    if set(manifest) - set(locked) - {"manifest.json"}:
        raise ValueError("Unspecified model in snapshot")
elif not any(key.startswith("daily.") for key in manifest) or not any(key.startswith("main.") for key in manifest):
    raise ValueError("ClamAV main/daily signature database missing")
(Path("/out") / (name + ".json")).write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
print(json.dumps({"asset": name, "files": len(files), "bytes": total}))
