"""Populate only empty release volumes; never download or overwrite differing assets."""
import hashlib
import json
import os
import tarfile
from pathlib import Path


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def restore(name, target, uid, gid):
    source = Path("/release/assets") / (name + ".tar")
    expected = json.loads((Path("/release/assets") / (name + ".json")).read_text())
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(source) as archive:
        members = archive.getmembers()
        files = {m.name.removeprefix("./") for m in members if m.isfile()}
        if files != set(expected):
            raise ValueError("Archive inventory differs: " + name)
        for member in members:
            relative = member.name.removeprefix("./")
            candidate = (target / relative).resolve()
            if not candidate.is_relative_to(target.resolve()) or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe archive member")
            if member.isfile():
                if candidate.exists():
                    if digest(candidate) != expected[relative]:
                        raise ValueError("Existing asset differs: " + relative)
                    continue
                candidate.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as stream, candidate.open("xb") as output:
                    while chunk := stream.read(1024 * 1024):
                        output.write(chunk)
                if digest(candidate) != expected[relative]:
                    candidate.unlink()
                    raise ValueError("Restored asset differs: " + relative)
                os.chown(candidate, uid, gid)
    for directory in [target, *(p for p in target.rglob("*") if p.is_dir())]:
        os.chown(directory, uid, gid)
    return {"asset": name, "files": len(expected), "verified": True}


if __name__ == "__main__":
    print(json.dumps([restore("models", Path("/models"), 1000, 1000), restore("clamav", Path("/clamav"), 100, 101)]))
