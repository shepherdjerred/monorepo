"""Fixed time curriculum and immutable, hash-pinned historical actor pool."""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path

import torch

from paper import FrozenOpponent
from policy import WIRE, Policy, array, digest, integer, load_checkpoint, mapping, write_checkpoint
from ppo import sample

CONFIG = mapping(json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8")))
DESCRIPTORS = [mapping(stage) for stage in array(CONFIG["stages"])]
if CONFIG["version"] != 1 or len(DESCRIPTORS) != 4:
    raise ValueError("unsupported curriculum")
if set(CONFIG) != {"version", "stages"} or any(
    set(stage) != {"name", "endFraction", "minUpdates", "opponents"} for stage in DESCRIPTORS
):
    raise ValueError("curriculum fields differ from contract")
STAGES = tuple(str(stage["name"]) for stage in DESCRIPTORS)
if STAGES != ("stationary", "chase-strafe", "authored-styles", "historical"):
    raise ValueError("unsupported curriculum ordering")
# Fractions of the remaining PPO collection window; BC and Paper boot consume
# the same outer seed budget. Advancement additionally requires a complete update.
BOUNDARIES = tuple(float(str(stage["endFraction"])) for stage in DESCRIPTORS)
MIN_UPDATES = tuple(integer(stage["minUpdates"], 1, 100) for stage in DESCRIPTORS)
OPPONENTS = [array(stage["opponents"]) for stage in DESCRIPTORS]
if (
    not all(0 < value <= 1 for value in BOUNDARIES)
    or tuple(sorted(set(BOUNDARIES))) != BOUNDARIES
    or BOUNDARIES[-1] != 1
    or any(
        not opponents or any(opponent not in array(WIRE["opponents"]) for opponent in opponents)
        for opponents in OPPONENTS
    )
):
    raise ValueError("invalid curriculum phases")


@dataclass
class Curriculum:
    began: float
    deadline: float
    diagnostic: bool = False
    stage: int = 0
    counts: list[int] = field(default_factory=lambda: [0] * len(STAGES))

    def choose(self, now: float) -> str:
        if self.stage < len(STAGES) - 1 and self.counts[self.stage] >= MIN_UPDATES[self.stage]:
            fraction = (now - self.began) / max(self.deadline - self.began, 0.001)
            if self.diagnostic or fraction >= BOUNDARIES[self.stage]:
                self.stage += 1
        return str(OPPONENTS[self.stage][self.counts[self.stage] % len(OPPONENTS[self.stage])])

    def completed(self) -> None:
        self.counts[self.stage] += 1

    def report(self) -> dict[str, object]:
        return {"stages": list(STAGES), "updates": self.counts.copy(), "complete": self.complete()}

    def complete(self) -> bool:
        return all(
            count >= minimum for count, minimum in zip(self.counts, MIN_UPDATES, strict=True)
        )


class History:
    def __init__(self, root: Path, dataset: str, seed: int) -> None:
        self.root = root
        self.dataset = dataset
        self.seed = seed
        self.entries: list[Path] = []

    def freeze(self, actor: Policy, updates: int, stage: str) -> None:
        path = self.root / f"actor-{len(self.entries):05d}"
        write_checkpoint(
            actor,
            path,
            {
                "dataset_sha256": self.dataset,
                "seed": self.seed,
                "updates_completed": updates,
                "stage": stage,
                "provenance": "frozen-training-history",
                "pilot_acceptance_checked": False,
            },
            "rwf-trooper-ppo",
        )
        self.entries.append(path)

    def select(self, randomizer: random.Random) -> FrozenOpponent:
        if not self.entries:
            raise ValueError("historical stage has no frozen actor")
        # Keep the BC anchor plus the most recent fifteen snapshots available.
        # Disk artifacts remain immutable for provenance and later evaluation.
        available = self.entries[:1] + self.entries[max(1, len(self.entries) - 15) :]
        path = randomizer.choice(available)
        actor, manifest = load_checkpoint(path)
        training = mapping(manifest["training"])
        if training.get("dataset_sha256") != self.dataset:
            raise ValueError("historical actor dataset mismatch")
        actor.eval().requires_grad_(False)
        hidden, cell = actor.initial(1, torch.device("cpu"))
        with torch.no_grad():
            output = actor.forward(torch.zeros(1, actor.encoder.in_features), hidden, cell)
            sample(output.logits, torch.Generator().manual_seed(0))
        return FrozenOpponent(actor, digest(path / "weights.pt"))
