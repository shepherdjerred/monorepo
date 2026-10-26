"""Seal one-time offline maintenance inputs without controlling backups or deployments."""

import argparse
import base64
import os
import struct
import subprocess
import time
import uuid
from pathlib import Path

from maintenance import files as storage
from maintenance.database import border_radii
from maintenance.values import JsonObject


def borders(path: Path) -> list[JsonObject]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("World border policy must be the regular owned YAML")
    result = subprocess.run(
        ["bun", "-e",
         "console.log(JSON.stringify({borders:Bun.YAML.parse(await Bun.file(process.argv[1]).text()).borders}))",
         str(path)],
        env={"PATH": os.environ["PATH"]}, capture_output=True, text=True, check=True, timeout=15,
    )
    selected = JsonObject.parse(result.stdout).objects("borders")
    border_radii(selected)
    return selected


def sites(path: Path) -> tuple[list[dict[str, object]], str]:
    """Use a captured MCBridge region rather than guesses about ground near spawn."""
    value = JsonObject.parse(path.read_bytes())
    region = value.object("region")
    bounds, size = region.object("min"), region.object("size")
    palette = region.string_list("palette")
    encoded = base64.b64decode(region.string("blocks"), validate=True)
    if region.get("world") != "world" or len(encoded) != 4 * size.integer("x") * size.integer("y") * size.integer("z"):
        raise ValueError("Grave recovery requires a complete main-world MCBridge region capture")

    def block(x: int, y: int, z: int) -> str:
        if any(not bounds.integer(axis) <= coordinate < bounds.integer(axis) + size.integer(axis)
               for coordinate, axis in ((x, "x"), (y, "y"), (z, "z"))):
            raise ValueError("Recovery site is outside its captured evidence")
        index = (((y - bounds.integer("y")) * size.integer("z") + z - bounds.integer("z"))
                 * size.integer("x") + x - bounds.integer("x"))
        return palette[struct.unpack_from("<I", encoded, 4 * index)[0]]

    result = []
    for site in value.objects("sites"):
        if set(site) != {"world", "x", "y", "z"} or site.get("world") != "world":
            raise ValueError("Recovery site must identify an exact main-world block")
        x, y, z = (site.integer(axis) for axis in ("x", "y", "z"))
        if (block(x, y, z) != "minecraft:air" or block(x, y + 1, z) != "minecraft:air"
                or block(x, y - 1, z) not in (
                    "minecraft:cobblestone", "minecraft:stone_bricks", "minecraft:stone", "minecraft:andesite")):
            raise ValueError("Recovery sites need two air blocks above verified solid ground")
        result.append(dict(site))
    return result, storage.digest(path)


def seal(data: Path, output: Path, candidate: Path, evidence: Path, native: Path, image: str) -> JsonObject:
    owned = Path(__file__).resolve().parent.parent
    world_config = owned / "owned/plugins/TheStorm/world.yml"
    if output.exists() or output.is_symlink() or output.resolve().is_relative_to(data.resolve()):
        raise ValueError("The sealed plan must be new and outside the world volume")
    for path in (candidate, evidence, native):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Maintenance inputs must be regular files")
    grave_sites, evidence_sha = sites(evidence)
    with storage.stopped(data):
        plan = JsonObject({
            "schemaVersion": 1, "scope": "circular-worlds", "requestId": str(uuid.uuid4()),
            "candidateImage": image, "candidateJarSha256": storage.digest(candidate),
            "nativeClassSha256": storage.digest(native), "graveSites": grave_sites,
            "siteEvidenceSha256": evidence_sha, "borders": borders(world_config),
            "worldConfigSha256": storage.digest(world_config), "files": storage.files(data),
            "sourceDevice": data.stat().st_dev, "sourceInode": data.stat().st_ino,
            "preparedAt": time.time_ns() // 1_000_000,
        })
        storage.save(output, plan)
        return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "output", "candidate", "evidence", "native"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--image", required=True)
    arguments = parser.parse_args()
    seal(arguments.data, arguments.output, arguments.candidate, arguments.evidence, arguments.native, arguments.image)
