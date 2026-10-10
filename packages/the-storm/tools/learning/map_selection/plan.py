"""Frozen map identities and paired rollout selection; no map enters through worker input."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from policy import array, integer, mapping

CONTRACT = mapping(
    json.loads(Path(__file__).parents[1].joinpath("maps/protocol.json").read_text(encoding="utf-8"))
)
if (
    CONTRACT["schema"] != 1
    or CONTRACT["kind"] != "rwf-training-maps"
    or CONTRACT["selection"] != "paired-round-robin"
):
    raise ValueError("unsupported frozen training map contract")


@dataclass(frozen=True)
class MapBinding:
    map: str
    blocks_sha256: str
    scenario_sha256: str

    @classmethod
    def parse(cls, raw: object) -> MapBinding:
        value = mapping(raw)
        if set(value) != set(array(CONTRACT["mapFields"])):
            raise ValueError("training map fields differ from the frozen contract")
        map_id = value["map"]
        if not isinstance(map_id, str) or re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", map_id) is None:
            raise ValueError("invalid training map identity")
        hashes = [value["blocksSha256"], value["scenarioSha256"]]
        if any(
            not isinstance(item, str) or re.fullmatch("[a-f0-9]{64}", item) is None
            for item in hashes
        ):
            raise ValueError("invalid training map hash")
        assert isinstance(hashes[0], str) and isinstance(hashes[1], str)
        return cls(map_id, hashes[0], hashes[1])

    def report(self) -> dict[str, object]:
        return {
            "map": self.map,
            "blocksSha256": self.blocks_sha256,
            "scenarioSha256": self.scenario_sha256,
        }


def read_maps(file: Path) -> list[MapBinding]:
    value = mapping(json.loads(file.read_text(encoding="utf-8")))
    if set(value) != set(array(CONTRACT["fields"])) or value["kind"] != CONTRACT["kind"]:
        raise ValueError("invalid frozen training map plan")
    integer(value["schema"], 1, 1)
    maps = [MapBinding.parse(item) for item in array(value["maps"])]
    ids = [item.map for item in maps]
    if not maps or ids != sorted(set(ids)):
        raise ValueError("training maps must be nonempty, unique and sorted")
    return maps


def rollout_map(maps: list[MapBinding], completed_games: int) -> MapBinding:
    integer(completed_games, 0, 2**63 - 1)
    if not maps:
        raise ValueError("training requires at least one admitted map")
    return maps[(completed_games // 2) % len(maps)]
