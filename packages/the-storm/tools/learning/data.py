"""Strict reader for hash-pinned, match-isolated human demonstration exports."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import torch
from torch import Tensor

from policy import CONTRACT, FEATURES, HEADS, RESOURCE, array, digest, integer, mapping, observation


@dataclass(frozen=True)
class Sequence:
    observations: Tensor
    actions: Tensor


@dataclass(frozen=True)
class Dataset:
    train: list[Sequence]
    validation: list[Sequence]
    test: list[Sequence]
    fingerprint: str

    @classmethod
    def load(cls, root: Path) -> Dataset:
        manifest_path = root / "manifest.json"
        manifest = mapping(json.loads(manifest_path.read_text(encoding="utf-8")))
        for key, expected in {
            "schema": 2,
            "contract": CONTRACT,
            "contract_sha256": digest(RESOURCE),
            "features": list(FEATURES),
            "tick_hz": 20,
            "max_ack_age_ticks": 2,
            "action": HEADS,
            "kit": "trooper",
            "sword_slot": 1,
            "combatants": 2,
            "provenance": "human-control-schema-3",
        }.items():
            if manifest.get(key) != expected:
                raise ValueError(f"dataset {key} mismatch; re-export the human recordings")
        assignments = mapping(manifest["split"])
        if len(assignments) < 10 or any(
            split not in ("train", "validation", "test") for split in assignments.values()
        ):
            raise ValueError("dataset requires ten matches and three nonempty splits")
        if set(assignments.values()) != {"train", "validation", "test"}:
            raise ValueError("dataset requires ten matches and three nonempty splits")
        sources = mapping(manifest["sources_sha256"])
        for match, split in assignments.items():
            if str(UUID(match)) != match or split not in ("train", "validation", "test"):
                raise ValueError("invalid match split")
            source = sources.get(match)
            if (
                not isinstance(source, str)
                or len(source) != 64
                or any(c not in "0123456789abcdef" for c in source)
            ):
                raise ValueError("missing source recording digest")
        files = mapping(manifest["files_sha256"])
        result: dict[str, list[Sequence]] = {}
        seen: set[str] = set()
        for split in ("train", "validation", "test"):
            path = root / f"{split}.jsonl"
            if digest(path) != files.get(path.name):
                raise ValueError("dataset split digest mismatch")
            values: list[Sequence] = []
            for line in path.read_text(encoding="utf-8").splitlines():
                row = mapping(json.loads(line))
                match = row["match"]
                if not isinstance(match, str) or assignments.get(match) != split:
                    raise ValueError("match leaked across dataset splits")
                seen.add(match)
                samples = array(row["samples"])
                if len(samples) < 2:
                    raise ValueError("isolated demonstration")
                observations: list[list[float]] = []
                actions: list[list[int]] = []
                previous: tuple[int, int, int] | None = None
                for sample in samples:
                    item = mapping(sample)
                    tick = integer(item["tick"], 0, 2**63 - 1)
                    seq = integer(item["sequence"], 0, 2**63 - 1)
                    ack = integer(item["observation_tick"], max(0, tick - 2), tick)
                    if previous and (
                        tick != previous[0] + 1
                        or seq != previous[1] + 1
                        or not 0 <= ack - previous[2] <= 1
                    ):
                        raise ValueError("discontinuous demonstration")
                    previous = tick, seq, ack
                    obs = observation(item["observation"])
                    if (
                        obs[FEATURES.index("HP")] <= 0
                        or obs[FEATURES.index("TARGET_KNOWN")] != 1
                        or obs[FEATURES.index("SLOT")] != 1 / 8
                        or obs[FEATURES.index("USING_ITEM")] != 0
                    ):
                        raise ValueError("demonstration is outside sword combat")
                    action = mapping(item["action"])
                    if set(action) != set(HEADS):
                        raise ValueError("unknown action head")
                    observations.append(obs)
                    actions.append(
                        [integer(action[key], 0, size - 1) for key, size in HEADS.items()]
                    )
                values.append(
                    Sequence(
                        torch.tensor(observations, dtype=torch.float32),
                        torch.tensor(actions, dtype=torch.long),
                    )
                )
            if not values:
                raise ValueError("empty dataset split")
            result[split] = values
        if seen != set(assignments):
            raise ValueError("declared match has no demonstration")
        train_actions = torch.cat([sequence.actions for sequence in result["train"]])
        if not (train_actions[:, 0] != 4).any() or not (train_actions[:, 4] == 1).any():
            raise ValueError("training split must contain movement and attacks")
        return cls(result["train"], result["validation"], result["test"], digest(manifest_path))


def batch(sequences: list[Sequence], where: torch.device) -> tuple[Tensor, Tensor, Tensor]:
    """Pad whole continuous segments; each batch member begins with reset memory."""
    if not sequences:
        raise ValueError("empty batch")
    length = max(sequence.observations.shape[0] for sequence in sequences)
    obs = torch.zeros(len(sequences), length, len(FEATURES), device=where)
    actions = torch.zeros(len(sequences), length, len(HEADS), dtype=torch.long, device=where)
    mask = torch.zeros(len(sequences), length, device=where)
    for index, sequence in enumerate(sequences):
        size = sequence.observations.shape[0]
        obs[index, :size] = sequence.observations.to(where)
        actions[index, :size] = sequence.actions.to(where)
        mask[index, :size] = 1
    return obs, actions, mask
