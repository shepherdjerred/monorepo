"""Read-only archive of a flushed Skylands save; reject changes during streaming."""

import argparse
import hashlib
import io
import json
import os
import stat
import sys
import tarfile
from pathlib import Path
from typing import BinaryIO

DIMENSION = "world/dimensions/minecraft/skylands"
ROOT_FILES = ("world/level.dat", ".the-storm-skylands-generation.json", ".the-storm-retired-worlds.json")


def snapshot(data: Path) -> dict[str, str]:
    for name in ("world", "world/dimensions", "world/dimensions/minecraft", DIMENSION):
        if (data / name).is_symlink() or not (data / name).is_dir():
            raise ValueError("Missing or linked save directory")
    paths = [data / name for name in ROOT_FILES]
    for name in (DIMENSION, "world/data", "world/datapacks"):
        root = data / name
        if root.is_symlink():
            raise ValueError("Linked archive root")
        if not root.exists() and name != DIMENSION:
            continue
        if not root.is_dir():
            raise ValueError("Missing Skylands dimension")
        for directory, children, names in os.walk(root, followlinks=False):
            for child in children:
                if (Path(directory) / child).is_symlink():
                    raise ValueError("Linked directory in save")
            paths.extend(Path(directory) / name for name in names if name != "session.lock")
    result = {}
    for path in paths:
        if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
            raise ValueError("Archive contains linked or non-regular data")
        with path.open("rb") as source:
            result[path.relative_to(data).as_posix()] = hashlib.file_digest(source, "sha256").hexdigest()
    required = DIMENSION + "/data/minecraft/world_gen_settings.dat"
    if required not in result:
        raise ValueError("Missing native generation settings")
    return dict(sorted(result.items()))


def archive(data: Path, output: BinaryIO) -> None:
    before = snapshot(data)
    with tarfile.open(fileobj=output, mode="w|") as tar:
        for name in before:
            tar.add(data / name, arcname="payload/" + name, recursive=False)
        if snapshot(data) != before:
            raise ValueError("Save changed during archive; discard this export")
        receipt = json.dumps({"schemaVersion": 1, "files": before}, sort_keys=True).encode()
        info = tarfile.TarInfo("export.json")
        info.size = len(receipt)
        info.mode = 0o600
        tar.addfile(info, io.BytesIO(receipt))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    archive(parser.parse_args().data, sys.stdout.buffer)
