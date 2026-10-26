"""Refuse an unprepared existing volume before the circular-world image syncs any configuration."""

import argparse
import json
import os
from pathlib import Path

MARKER = ".the-storm-retired-worlds.json"


def require_preparation(data: Path) -> None:
    if data.is_symlink() or not data.is_dir():
        raise ValueError("World retirement requires the existing regular data volume")
    for name in ("wilds", "peaks"):
        path = data / "world/dimensions/minecraft" / name
        if path.exists() or path.is_symlink():
            raise ValueError("Finish verified stopped-volume retirement of Wilds and Peaks before starting this image")
    marker = data / MARKER
    if marker.is_symlink():
        raise ValueError("World retirement marker cannot be linked")
    if not marker.exists():
        if (data / "world/level.dat").exists() or (data / "plugins/TheStorm/the-storm.db").exists():
            raise ValueError("Existing data requires verified world retirement before activation")
        # A genuinely new server has no historical players, graves or worlds to retire.
        value = {
            "schemaVersion": 1,
            "status": "COMPLETE",
            "retired": ["wilds", "peaks"],
            "requestId": "new-world",
        }
        with marker.open("x", encoding="utf-8") as output:
            json.dump(value, output)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        descriptor = os.open(data, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    if not marker.is_file():
        raise ValueError("World retirement marker must be a regular file")
    value = json.loads(marker.read_bytes())
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != 1
        or value.get("status") != "COMPLETE"
        or value.get("retired") != ["wilds", "peaks"]
        or not isinstance(value.get("requestId"), str)
        or not value["requestId"]
    ):
        raise ValueError("World retirement is incomplete; keep this volume offline")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    require_preparation(parser.parse_args().data)
