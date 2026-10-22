"""Verify converted-chunk rendering settings without loading or ticking the historical world."""

import argparse
import json
import re
import uuid
from pathlib import Path

import restoration_files as storage
from restoration_json import JsonObject

# Repository-owned BlueMap maps for restored archive worlds. Converted 1.8 chunks
# carry missing or zeroed light data, so each map renders without waiting for
# light and at full ambient brightness. The image installs these files on boot.
ARCHIVE_MAPS = {"world.conf": "minecraft:overworld", "map2.conf": "minecraft:map2"}
LIGHTING = ("ignore-missing-light-data: true", "ambient-light: 1")


def render_unlit(data: Path, request: str, jar_sha: str) -> JsonObject:
    if str(uuid.UUID(request)) != request or re.fullmatch(r"[a-f0-9]{64}", jar_sha) is None:
        raise ValueError("Map rendering requires an exact request and published JAR hash")
    if data.is_symlink():
        raise ValueError("Map data root cannot be linked")
    data = data.resolve(strict=True)
    workspace = data / storage.WORKSPACE / request
    maps = data / "plugins/BlueMap/maps"
    receipt_path = workspace / "bluemap-render.json"
    configs = [maps / name for name in ARCHIVE_MAPS]
    for path in (workspace, workspace / "journal.json", receipt_path, *configs, *maps.parents):
        if path.is_symlink():
            raise ValueError("Map rendering inputs cannot be linked")
    installed = JsonObject.parse((workspace / "journal.json").read_bytes())
    if (
        installed.get("phase") != "INSTALLED"
        or installed.get("requestId") != request
        or installed.get("candidateJarSha256") != jar_sha
        or storage.digest(data / "plugins/TheStorm.jar") != jar_sha
    ):
        raise ValueError("Map rendering requires this installed candidate")
    hashes = {}
    for config in configs:
        lines = config.read_text(encoding="utf-8").splitlines()
        lighting = [line for line in lines if line.startswith(("ignore-missing-light-data:", "ambient-light:"))]
        if (
            lines.count('world: "world"') != 1
            or lines.count(f'dimension: "{ARCHIVE_MAPS[config.name]}"') != 1
            or sorted(lighting) != sorted(LIGHTING)
        ):
            raise ValueError("Owned map configuration lacks converted-chunk lighting: " + config.name)
        hashes[config.name] = storage.digest(config)
    receipt = JsonObject(
        {
            "requestId": request,
            "candidateJarSha256": jar_sha,
            "phase": "VERIFIED",
            "configSha256": hashes["world.conf"],
            "configs": hashes,
            "worldTicks": 0,
        }
    )
    if {name: storage.digest(config) for name, config in zip(ARCHIVE_MAPS, configs, strict=True)} != hashes:
        raise ValueError("Map configuration changed during verification")
    storage.save(receipt_path, receipt)
    return JsonObject(
        {key: receipt[key] for key in ("requestId", "candidateJarSha256", "phase", "configSha256", "worldTicks")}
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--jar-sha", required=True)
    arguments = parser.parse_args()
    print(json.dumps(render_unlit(Path("/data"), arguments.request, arguments.jar_sha)))
