"""Check Skylands' generation identity before Paper can load or generate any chunks."""

import argparse
import json
import os
import re
from pathlib import Path

MARKER = ".the-storm-skylands-generation.json"


def identity(config: Path) -> dict[str, str | int]:
    value = json.loads(config.read_bytes())
    if (
        not isinstance(value, dict)
        or set(value) != {"world", "seed", "format"}
        or not isinstance(value["world"], str)
        or not re.fullmatch(r"[a-z0-9_]+", value["world"])
        or type(value["seed"]) is not int
        or not -(2**63) <= value["seed"] < 2**63
        or value["format"] != "layered-v1"
    ):
        raise ValueError("Skylands requires an exact world, signed 64-bit seed and layered-v1 format")
    return value


def require_generation(data: Path, config: Path) -> None:
    expected = identity(config)
    world = str(expected["world"])
    if data.is_symlink() or not data.is_dir():
        raise ValueError("Skylands requires a regular data volume")
    dimension = data / "world/dimensions/minecraft" / world
    for path in (data / "world", data / "world/dimensions", dimension.parent, dimension, data / world):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise ValueError("Skylands world paths must be regular directories")
    if (data / world).exists():
        raise ValueError("Legacy Skylands terrain requires an offline replacement before layered startup")
    marker = data / MARKER
    if marker.is_symlink() or (marker.exists() and not marker.is_file()):
        raise ValueError("Skylands generation marker must be a regular file")
    if marker.exists():
        recorded = identity(marker)
        if recorded != expected:
            raise ValueError("Skylands generation identity changed; keep the volume offline for replacement")
        return
    if dimension.exists():
        raise ValueError(
            "Existing Skylands has no layered generation identity; finish offline replacement before startup"
        )
    # Keep this outside the dimension: pre-creating that directory makes Paper treat it as existing.
    with marker.open("x", encoding="utf-8") as output:
        json.dump(expected, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    descriptor = os.open(data, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    require_generation(args.data, args.config)
