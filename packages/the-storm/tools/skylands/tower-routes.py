"""Trace level, guarded approaches against a saved Skylands copy, never against live blocks."""

# /// script
# requires-python = ">=3.13"
# dependencies = ["nbtlib>=2.0.4,<3", "numpy>=2.2,<3"]
# ///

import argparse
import heapq
import json
from functools import cache
from pathlib import Path
from typing import Any

from anvil import Anvil


def vegetation(name: str) -> bool:
    short = name.removeprefix("minecraft:")
    return short in {
        "air",
        "cave_air",
        "void_air",
        "snow",
        "short_grass",
        "tall_grass",
        "fern",
        "large_fern",
        "dead_bush",
        "vine",
        "leaf_litter",
        "pink_petals",
        "wildflowers",
        "dandelion",
        "poppy",
        "blue_orchid",
        "allium",
        "azure_bluet",
        "oxeye_daisy",
        "cornflower",
        "lily_of_the_valley",
        "brown_mushroom",
        "red_mushroom",
        "sugar_cane",
        "sunflower",
        "lilac",
        "rose_bush",
        "peony",
        "bush",
        "firefly_bush",
        "hanging_roots",
        "cactus",
        "pale_hanging_moss",
        "moss_carpet",
        "flowering_azalea",
        "azalea",
        "torchflower",
    } or short.endswith(("_leaves", "_log", "_sapling", "_tulip"))


def ground(name: str) -> bool:
    short = name.removeprefix("minecraft:")
    return short in {
        "stone",
        "dirt",
        "grass_block",
        "snow_block",
        "sand",
        "red_sand",
        "sandstone",
        "red_sandstone",
        "tuff",
        "mycelium",
        "mud",
        "coarse_dirt",
        "podzol",
        "moss_block",
        "rooted_dirt",
        "granite",
        "andesite",
        "diorite",
        "calcite",
        "packed_ice",
    } or short.endswith("terracotta")


def route(
    source: Anvil, base: dict[str, Any], goals: list[tuple[int, int]], limit: int, rise: int = 0
) -> list[list[int]]:
    """Five-wide deck, three-wide interior; avoid excavation, water and existing structures."""
    x0, y, z0 = base["x"], base["y"] + rise, base["z"]

    @cache
    def cost(x: int, z: int) -> float:
        doorway = (abs(x) <= 2 and abs(z) >= 12) or (x >= 12 and abs(z) <= 2) or (x <= -12 and abs(z + 5) <= 2)
        if max(abs(x), abs(z)) > limit or (abs(x) <= 13 and abs(z) <= 13 and not doorway):
            return float("inf")
        grading = 0
        for dx in range(-2, 3):
            for dz in range(-2, 3):
                for dy in range(4):
                    name = source.block((x0 + x + dx, y + dy, z0 + z + dz))[0]
                    if vegetation(name):
                        continue
                    if dy < 2 and ground(name):
                        grading += 1
                    else:
                        return float("inf")
        # Prefer a boardwalk near existing ground over a longer bridge over open void.
        land = ground(source.block((x0 + x, y - 1, z0 + z))[0])
        return (1.0 if land else 1.6) + grading * 0.25

    destinations = {goal for goal in goals if cost(*goal) != float("inf")}
    if not destinations:
        raise ValueError(f"No landing has five-wide headroom at {base}")
    starts = {(0, -24)} if rise else {(0, -12), (12, 0), (0, 12), (-12, -5)}
    queued = [(0.0, 0.0, start) for start in starts]
    heapq.heapify(queued)
    distances = dict.fromkeys(starts, 0.0)
    parents = {}
    while queued:
        _, travelled, at = heapq.heappop(queued)
        if travelled != distances[at]:
            continue
        if at in destinations:
            result = [at]
            while result[-1] not in starts:
                result.append(parents[result[-1]])
            result.reverse()
            prefix = []
            if rise:
                for z in range(-12, -24, -1):
                    progress = max(0, -z - 16)
                    dy = min(abs(rise), progress) * (1 if rise > 0 else -1)
                    prefix.append([0, base["y"] + dy, z])
                # Grading is allowed only two blocks into natural ground, never an access tunnel.
                for px, py, pz in prefix:
                    for dx in range(-2, 3):
                        for dz in range(-2, 3):
                            for dy in range(4):
                                name = source.block((x0 + px + dx, py + dy, z0 + pz + dz))[0]
                                if not vegetation(name) and not (dy < 2 and ground(name)):
                                    raise ValueError(
                                        f"Ramp intersects terrain at {(x0 + px + dx, py + dy, z0 + pz + dz)}"
                                    )
            return prefix + [[x, y, z] for x, z in result]
        x, z = at
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            next_at = x + dx, z + dz
            distance = travelled + cost(*next_at)
            if distance < distances.get(next_at, float("inf")):
                distances[next_at] = distance
                parents[next_at] = at
                heuristic = min(abs(next_at[0] - goal[0]) + abs(next_at[1] - goal[1]) for goal in destinations)
                heapq.heappush(queued, (distance + heuristic, distance, next_at))
    raise ValueError(f"No safe level approach from {base} to {destinations}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--landings", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to overwrite an existing reviewed route plan")
    catalog = json.loads(args.catalog.read_text())
    goals = json.loads(args.landings.read_text())
    result = []
    for tower in catalog["towers"]:
        source = Anvil(args.world)
        choices = goals[tower["id"]]
        rise = choices[0][2]
        if any(choice[2] != rise for choice in choices):
            raise ValueError("Choose a single reviewed approach elevation before routing")
        points = route(
            source,
            tower["base"],
            [tuple(choice[:2]) for choice in choices],
            max(80, max(max(abs(c[0]), abs(c[1])) for c in choices) + 12),
            rise,
        )
        # Leave the landing's centre open, so travellers can enter from outside the rails.
        result.append({"id": tower["id"], "points": points, "landing": [points[-1][0], points[-1][2], rise]})
        args.output.with_suffix(".partial.json").write_text(json.dumps(result, indent=2) + "\n")
        print(tower["id"], len(points), "approach cells", flush=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
