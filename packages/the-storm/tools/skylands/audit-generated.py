"""Inspect actual saved native generation. Run with uv --with nbtlib --with numpy."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["nbtlib>=2.0.4,<3", "numpy>=2.2,<3"]
# ///

import argparse
import collections
import hashlib
import json
from pathlib import Path

from anvil import Anvil

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
args = parser.parse_args()
root = args.directory.resolve()
result = json.loads((root / "generation-result.json").read_text())
defaults = {}
for name, state in json.loads((root / "block-defaults.json").read_text()).items():
    defaults[name] = (
        dict(v.split("=", 1) for v in state.split("[", 1)[1].rstrip("]").split(",")) if "[" in state else {}
    )
world = Anvil(root / "world/dimensions/minecraft/sky_generated", defaults)
reports = []
digests = {}
for plan in result["witnesses"]:
    detail = [e for e in plan["edits"] if e["phase"] == "DETAIL"]
    digest = hashlib.sha256()
    for edit in sorted(detail, key=lambda e: (e["position"]["x"], e["position"]["y"], e["position"]["z"])):
        p = tuple(edit["position"][k] for k in ("x", "y", "z"))
        actual, props = world.block(p)
        expected = edit["block"].split("[")[0]
        assert actual == expected, ("generated feature differs", plan["cell"], p, edit["block"], actual)
        if "[" in edit["block"]:
            required = dict(v.split("=", 1) for v in edit["block"].split("[", 1)[1].rstrip("]").split(","))
            assert all(props.get(k) == v for k, v in required.items()), (
                "generated block properties differ",
                plan["cell"],
                p,
                edit["block"],
                props,
            )
        digest.update(json.dumps([p, actual, sorted(props.items())], separators=(",", ":")).encode())
    count = collections.Counter()
    crop_lights = []
    loot = []
    positions = set()
    for piece in plan["pieces"]:
        origin = piece["origin"]
        size = piece["template"]["size"]
        sx, sz = (size["x"], size["z"]) if piece["quarterTurns"] % 2 == 0 else (size["z"], size["x"])
        for x in range(origin["x"], origin["x"] + sx):
            for z in range(origin["z"], origin["z"] + sz):
                for y in range(origin["y"], origin["y"] + size["y"]):
                    p = x, y, z
                    actual, props = world.block(p)
                    assert actual not in {"minecraft:jigsaw", "minecraft:structure_void"}, ("unresolved connector", p)
                    count[actual] += 1
                    if actual in {"minecraft:wheat", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroots"}:
                        crop_lights.append(world.light(p))
        for cx in range(origin["x"] // 16, (origin["x"] + sx - 1) // 16 + 1):
            for cz in range(origin["z"] // 16, (origin["z"] + sz - 1) // 16 + 1):
                if (cx, cz) in positions:
                    continue
                positions.add((cx, cz))
                for entity in world.chunk(cx, cz)["block_entities"]:
                    table = entity.get("LootTable", entity.get("loot_table"))
                    if table is not None:
                        loot.append(str(table))
    kind = plan["kind"]
    if kind == "VILLAGE":
        assert sum(v for k, v in count.items() if k.endswith("_bed")) >= 12
        assert len(crop_lights) >= 20 and min(crop_lights) >= 9, ("crops", len(crop_lights), crop_lights)
        assert count["minecraft:composter"] and count["minecraft:lectern"]
    if kind == "ANCIENT_CITY":
        # Native core: 55 palette cells plus its city_anchor jigsaw's final_state.
        assert count["minecraft:reinforced_deepslate"] == 56
        assert any("ancient_city" in key for key in loot), ("native city loot absent", loot)
        assert any("sculk_shrieker[can_summon=true]" in e["block"] for e in detail)
    rails = sum(e["block"].startswith("minecraft:rail[") for e in detail)
    if kind == "MINE":
        assert rails >= 120
        assert any(e["block"] == "minecraft:spawner" for e in detail)
        for edit in detail:
            if edit["block"] != "minecraft:spawner":
                continue
            p = edit["position"]
            tile = next(
                b
                for b in world.chunk(p["x"] // 16, p["z"] // 16)["block_entities"]
                if all(int(b[k]) == p[k] for k in ("x", "y", "z"))
            )
            assert str(tile["SpawnData"]["entity"]["id"]) == "minecraft:cave_spider"
        for edit in detail:
            if not edit["block"].startswith("minecraft:rail["):
                continue
            p = tuple(edit["position"][k] for k in ("x", "y", "z"))
            assert world.block((p[0], p[1] - 1, p[2]))[0] in {"minecraft:stone", "minecraft:spruce_planks"}
            assert world.block((p[0], p[1] + 1, p[2]))[0] == "minecraft:air"
    key = f"{plan['cell']['x']},{plan['cell']['z']}"
    digests[key] = digest.hexdigest()
    reports.append(
        {
            "cell": plan["cell"],
            "kind": kind,
            "nativePieces": len(plan["pieces"]),
            "detailCellsMatched": len(detail),
            "railCells": rails,
            "cropCount": len(crop_lights),
            "minimumCropBlockLight": min(crop_lights) if crop_lights else None,
            "nativeCityLootTables": dict(collections.Counter(loot)) if kind == "ANCIENT_CITY" else {},
            "pieceHeightRange": [
                min((p["origin"]["y"] for p in plan["pieces"]), default=None),
                max((p["origin"]["y"] for p in plan["pieces"]), default=None),
            ],
        }
    )
entities = list(world.entities())
counts = collections.Counter(str(e["id"]) for e in entities)
expected_villagers = sum(r["kind"] == "VILLAGER" for p in result["witnesses"] for r in p["residents"])
expected_carts = sum(r["kind"] == "LOOT_MINECART" for p in result["witnesses"] for r in p["residents"])
assert counts["minecraft:villager"] >= expected_villagers, ("missing villagers", counts, expected_villagers)
for kind, entity in {"IRON_GOLEM": "minecraft:iron_golem", "CAT": "minecraft:cat"}.items():
    expected = sum(r["kind"] == kind for p in result["witnesses"] for r in p["residents"])
    assert counts[entity] >= expected, ("missing native village resident", entity, expected, counts)
for plan in result["witnesses"]:
    for resident in plan["residents"]:
        if resident["kind"] != "VILLAGER":
            continue
        p = tuple(resident["position"][k] for k in ("x", "y", "z"))
        assert world.block(p)[0] in {
            "minecraft:air",
            "minecraft:cave_air",
            "minecraft:wall_torch",
            "minecraft:torch",
        } or world.block(p)[0].endswith("_carpet"), ("blocked villager", p, world.block(p))
carts = [e for e in entities if str(e["id"]) == "minecraft:chest_minecart"]
assert len(carts) >= expected_carts
assert all(str(e.get("LootTable")) == "minecraft:chests/abandoned_mineshaft" for e in carts)
report = {
    "seed": result["seed"],
    "order": result["order"],
    "requestedChunks": result["chunks"],
    "source": "Saved native Anvil blocks, light, tile entities and entities; no post-generation placement",
    "witnesses": reports,
    "detailDigests": digests,
    "entities": dict(counts),
}
(root / "native-audit.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
