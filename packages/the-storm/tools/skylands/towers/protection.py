"""Keep commissioned beacon aprons and approach buffers in the owned towns configuration."""

import argparse
import json
from itertools import pairwise
from pathlib import Path
from typing import Any

START = "  # BEGIN generated Skylands beacon protection"
END = "  # END generated Skylands beacon protection"
LEGACY = "  # Surveyed public tower reservations."
POLICY = """    allow:
      - action: INTERACT
        subjects:
          [
            DOOR,
            TRAPDOOR,
            FENCE_GATE,
            BUTTON,
            LEVER,
            PRESSURE_PLATE,
            TRIPWIRE,
            BELL,
          ]
      - action: INTERACT_ENTITY
        subjects: [VILLAGER, VEHICLE, ANIMAL]
      - action: OPEN_CONTAINER
        subjects: [CONTAINER]
      - action: TELEPORT_INTO
        subjects: [LOCATION, ENDER_PEARL, CHORUS_FRUIT]
      - action: SET_HOME
        subjects: [LOCATION]
      - action: ATTACK_PLAYER
        subjects: [PLAYER]
    mobSpawns:
      limited: false
      allow: []
"""


def cuboid(x0: int, y: int, z0: int, x1: int, z1: int) -> str:
    return (
        "        - world: skylands\n"
        f"          from: {{ x: {x0}, y: {y}, z: {z0} }}\n"
        f"          to: {{ x: {x1}, y: 319, z: {z1} }}\n"
    )


def generated(catalog: dict[str, Any], layout: dict[str, Any]) -> str:
    if catalog["world"] != "skylands":
        raise ValueError("Beacon protection is scoped to Skylands")
    approaches = {entry["id"]: entry for entry in layout["towers"]}
    if set(approaches) != {tower["id"] for tower in catalog["towers"]}:
        raise ValueError("Catalog and approach IDs differ")
    commissioned = [tower for tower in catalog["towers"] if tower["commissioned"]]
    text = START + "\n"
    if commissioned:
        text += "  - id: skylands-towers\n    name: Skylands Launch Towers\n    profile: PRESERVE\n"
        text += "    areas:\n      chunks: []\n      cuboids:\n"
    # Aprons come first so their exact boundaries can be checked independently of the paths.
    for tower in commissioned:
        x, y, z = (tower["base"][key] for key in ("x", "y", "z"))
        text += f"        # {tower['id']} apron.\n" + cuboid(x - 48, y - 16, z - 48, x + 48, z + 48)
    for tower in commissioned:
        x, y, z = (tower["base"][key] for key in ("x", "y", "z"))
        points = approaches[tower["id"]]["waypoints"]
        for before, after in pairwise(points):
            x0, x1 = min(before[0], after[0]) - 10, max(before[0], after[0]) + 10
            z0, z1 = min(before[2], after[2]) - 10, max(before[2], after[2]) + 10
            if x0 >= -48 and x1 <= 48 and z0 >= -48 and z1 <= 48:
                continue
            text += f"        # {tower['id']} approach: deck plus eight-block edge buffer.\n"
            text += cuboid(x + x0, y - 16, z + z0, x + x1, z + z1)
    if commissioned:
        text += POLICY
    return text + END + "\n"


def replace_owned(text: str, replacement: str) -> str:
    if START in text:
        if text.count(START) != 1 or text.count(END) != 1:
            raise ValueError("Malformed generated protection boundaries")
        before, rest = text.split(START, 1)
        _, after = rest.split(END, 1)
        return before + replacement.rstrip("\n") + after
    if LEGACY in text:
        before, old = text.split(LEGACY, 1)
        if old.count("  - id:") != 1 or "  - id: skylands-towers\n" not in old:
            raise ValueError("Legacy reservations are not the final standalone region")
        return before + replacement
    return text.rstrip("\n") + "\n\n" + replacement


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--layout", type=Path, required=True)
    parser.add_argument("--towns", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    before = args.towns.read_text()
    expected = replace_owned(
        before, generated(json.loads(args.catalog.read_text()), json.loads(args.layout.read_text()))
    )
    if args.write:
        args.towns.write_text(expected)
    elif before != expected:
        raise ValueError("Beacon protection differs from its commissioned catalog and approach plan")


if __name__ == "__main__":
    main()
