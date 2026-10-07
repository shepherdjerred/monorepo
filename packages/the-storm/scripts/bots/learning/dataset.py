"""Validate RWF demonstrations and export continuous, match-isolated sequences.

Only the standard library is required. Actor inputs come exclusively from the
server's fair observation contract; roster/outcome data are evaluation metadata.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import random
import struct
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO, TypedDict
from uuid import UUID

CONTRACT = Path(__file__).resolve().parents[3] / (
    "plugin/modules/rwfbots/src/main/resources/rwf-combat-v1.tsv"
)
CONTRACT_ID = "rwf-combat-v1"
# Matches rwfbots.app.Loadouts: fuse 0, sword 1, apples/bow 2.
SWORD_SLOT = 1


class Action(TypedDict):
    move: int
    jump: int
    sneak: int
    sprint: int
    attack: int


class Sample(TypedDict):
    tick: int
    sequence: int
    observation_tick: int
    observation: tuple[float, ...]
    action: Action


class CombatSequence(TypedDict):
    match: str
    actor: str
    won: bool
    reason: str
    samples: list[Sample]


def features(path: Path = CONTRACT) -> tuple[str, ...]:
    fields = [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines()]
    if not fields or any(len(row) != 2 for row in fields):
        raise ValueError("invalid observation contract")
    names = tuple(row[0] for row in fields)
    if len(set(names)) != len(names):
        raise ValueError("duplicate observation feature")
    if any(not math.isfinite(float(row[1])) or float(row[1]) <= 0 for row in fields):
        raise ValueError("invalid observation scale")
    return names


def boolean(text: str) -> bool:
    if text not in ("true", "false"):
        raise ValueError("invalid boolean")
    return text == "true"


def float32(value: float) -> float:
    if not math.isfinite(value) or not -1 <= value <= 1:
        raise ValueError("nonfinite or unnormalized observation")
    return struct.unpack("!f", struct.pack("!f", value))[0]


@dataclass(frozen=True)
class Controls:
    tick: int
    actor: str
    keys: int
    yaw: int
    pitch: int
    attack: bool
    use: bool
    slot: int
    sequence: int
    observation_tick: int
    source: str

    @classmethod
    def parse(cls, row: list[str]) -> Controls:
        if len(row) != 12:
            raise ValueError("schema 3 requires complete input rows")
        value = cls(int(row[1]), row[2], int(row[3]), int(row[4]), int(row[5]),
                    boolean(row[6]), boolean(row[7]), int(row[8]), int(row[9]),
                    int(row[10]), row[11])
        if (value.tick < 0 or not 0 <= value.keys <= 127 or not 0 <= value.yaw < 36000
                or not -9000 <= value.pitch <= 9000 or not 0 <= value.slot <= 8
                or value.sequence < -1 or not -1 <= value.observation_tick <= value.tick
                or value.source not in ("HUMAN", "AUTOMATED", "MISSING")
                or (value.source == "MISSING") != (value.sequence == -1)):
            raise ValueError("invalid input controls or provenance")
        return value


@dataclass
class Recording:
    match: str
    roster: dict[str, tuple[str, str, bool]] = field(default_factory=dict)
    inputs: list[Controls] = field(default_factory=list)
    observations: dict[tuple[str, int], tuple[float, ...]] = field(default_factory=dict)
    frames: dict[tuple[str, int], tuple[int, int]] = field(default_factory=dict)
    winner: str = "-"
    reason: str = ""


def read(stream: TextIO) -> Recording:
    record: Recording | None = None
    ended = False
    count = len(features())
    for number, line in enumerate(stream, 1):
        row = line.rstrip("\n").split("\t")
        tag = row[0]
        try:
            if tag == "H":
                if record is not None or len(row) != 7 or row[1] != "3":
                    raise ValueError("training requires exactly one schema 3 header")
                record = Recording(str(UUID(row[2])))
            elif record is None:
                raise ValueError("row before header")
            elif tag == "R":
                if len(row) != 5 or row[1] in record.roster or row[2] not in ("RED", "BLUE"):
                    raise ValueError("invalid or duplicate roster row")
                record.roster[row[1]] = (row[2], row[3], boolean(row[4]))
            elif tag == "N":
                record.inputs.append(Controls.parse(row))
            elif tag == "O":
                if len(row) != count + 4 or row[3] != CONTRACT_ID:
                    raise ValueError("observation contract mismatch")
                key = (row[2], int(row[1]))
                if key in record.observations or key[1] < 0:
                    raise ValueError("duplicate or negative observation tick")
                record.observations[key] = tuple(float32(float(value)) for value in row[4:])
            elif tag == "F":
                if len(row) != 11:
                    raise ValueError("invalid frame size")
                key = (row[2], int(row[1]))
                yaw, health = int(row[6]), int(row[8])
                if key in record.frames or key[1] < 0 or not 0 <= yaw <= 255 or health < 0:
                    raise ValueError("invalid or duplicate frame")
                record.frames[key] = (yaw, health)
            elif tag == "X":
                if ended or len(row) != 4 or row[2] not in ("RED", "BLUE", "-") or int(row[1]) < 0:
                    raise ValueError("invalid or duplicate end row")
                record.winner, record.reason = row[2], row[3]
                ended = True
            elif tag not in ("E", "I", "P"):
                raise ValueError(f"unknown row {tag}")
        except (ValueError, IndexError) as error:
            raise ValueError(f"line {number}: {error}") from error
    if record is None or not ended or not record.roster:
        raise ValueError("incomplete recording")
    for key in (*record.observations, *record.frames):
        if key[0] not in record.roster:
            raise ValueError("sample refers to an unknown actor")
    last: dict[str, Controls] = {}
    last_sequence: dict[str, int] = {}
    for control in record.inputs:
        if control.actor not in record.roster or record.roster[control.actor][2]:
            raise ValueError("input actor must be a rostered human")
        previous = last.get(control.actor)
        if ((previous and control.tick <= previous.tick)
                or (control.sequence >= 0 and control.sequence <= last_sequence.get(control.actor, -1))):
            raise ValueError("duplicate or out-of-order human inputs")
        last[control.actor] = control
        if control.sequence >= 0:
            last_sequence[control.actor] = control.sequence
    return record


def action(control: Controls, observed_yaw: int) -> Action:
    # Human keys use the client's look direction. Convert to the acknowledged
    # observation's basis so a camera turn is not mislabeled as a movement turn.
    forward = int(bool(control.keys & 1)) - int(bool(control.keys & 2))
    side = int(bool(control.keys & 8)) - int(bool(control.keys & 4))
    delta = math.radians(control.yaw / 100 - observed_yaw * 360 / 256)
    # Positive Minecraft yaw rotates south (+Z) towards west (-X), which is
    # right relative to a south-facing observer. Keep that handedness here.
    f = forward * math.cos(delta) - side * math.sin(delta)
    s = forward * math.sin(delta) + side * math.cos(delta)
    if forward == side == 0:
        move = 4
    else:
        sector = math.floor(math.atan2(s, f) / (math.pi / 4) + 0.5)
        f, s = round(math.cos(sector * math.pi / 4)), round(math.sin(sector * math.pi / 4))
        move = (f + 1) * 3 + s + 1
    return {"move": move, "jump": int(bool(control.keys & 16)),
            "sneak": int(bool(control.keys & 32)), "sprint": int(bool(control.keys & 64)),
            "attack": int(control.attack)}


def sequences(record: Recording, *, combatants: int = 2) -> tuple[list[CombatSequence], Counter[str]]:
    chunks: list[CombatSequence] = []
    counts: Counter[str] = Counter()
    names = features()
    hp, known = names.index("HP"), names.index("TARGET_KNOWN")
    current: dict[str, list[Sample]] = {}
    previous: dict[str, Controls] = {}

    def finish(actor: str) -> None:
        samples = current.pop(actor, [])
        if len(samples) >= 2:
            chunks.append({"match": record.match, "actor": actor,
                           "won": record.roster[actor][0] == record.winner,
                           "reason": record.reason, "samples": samples})
            counts["accepted"] += len(samples)
        else:
            counts["isolated"] += len(samples)

    for control in record.inputs:
        actor = control.actor
        obs_key = (actor, control.observation_tick)
        obs = record.observations.get(obs_key)
        frame = record.frames.get(obs_key)
        reason = ""
        if len(record.roster) != combatants:
            reason = "wrong_match_size"
        elif record.roster[actor][1] != "trooper":
            reason = "other_kit"
        elif control.source != "HUMAN":
            reason = control.source.lower()
        elif not 0 <= control.tick - control.observation_tick <= 2:
            reason = "stale_or_unacknowledged"
        elif obs is None or frame is None:
            reason = "observation_gap"
        elif obs[hp] <= 0 or obs[known] != 1:
            reason = "outside_combat"
        elif (control.use or control.slot != SWORD_SLOT
              or obs[names.index("USING_ITEM")] > 0 or obs[names.index("SLOT")] != SWORD_SLOT / 8):
            reason = "authored_item_action"
        if reason:
            counts[reason] += 1
            finish(actor)
            previous.pop(actor, None)
            continue
        old = previous.get(actor)
        if old and (control.tick != old.tick + 1 or control.sequence != old.sequence + 1
                    or not 0 <= control.observation_tick - old.observation_tick <= 1):
            counts["sequence_breaks"] += 1
            finish(actor)
        assert obs is not None and frame is not None
        current.setdefault(actor, []).append({
            "tick": control.tick, "sequence": control.sequence,
            "observation_tick": control.observation_tick, "observation": obs,
            "action": action(control, frame[0]),
        })
        previous[actor] = control
    for actor in list(current):
        finish(actor)
    return chunks, counts


def action_counts(chunks: list[CombatSequence]) -> dict[str, dict[str, int]]:
    counts = {head: {str(index): 0 for index in range(size)}
              for head, size in (("move", 9), ("jump", 2), ("sneak", 2), ("sprint", 2), ("attack", 2))}
    for chunk in chunks:
        for sample in chunk["samples"]:
            value = sample["action"]
            for head, index in (("move", value["move"]), ("jump", value["jump"]),
                                ("sneak", value["sneak"]), ("sprint", value["sprint"]),
                                ("attack", value["attack"])):
                counts[head][str(index)] += 1
    return counts


def split_matches(matches: list[str], seed: int) -> dict[str, str]:
    if len(matches) < 10 or len(set(matches)) != len(matches):
        raise ValueError("export requires at least 10 distinct usable matches")
    ordered = sorted(matches)
    random.Random(seed).shuffle(ordered)
    held_out = max(1, len(ordered) // 10)
    return {match: ("test" if index < held_out else "validation"
                   if index < 2 * held_out else "train")
            for index, match in enumerate(ordered)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("inspect", "export"))
    parser.add_argument("recordings", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--combatants", type=int, default=2)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    if args.combatants < 2:
        parser.error("--combatants must be at least 2")
    paths = sorted({path for item in args.recordings for path in (
        item.rglob("*.rwfrec.gz") if item.is_dir() else [item])})
    if not paths:
        parser.error("no recordings found")
    all_chunks: list[CombatSequence] = []
    totals: Counter[str] = Counter()
    matches: set[str] = set()
    sources: dict[str, str] = {}
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            record = read(stream)
        if record.match in matches:
            raise ValueError("duplicate match recording")
        matches.add(record.match)
        chunks, counts = sequences(record, combatants=args.combatants)
        all_chunks.extend(chunks)
        totals.update(counts)
        sources[record.match] = hashlib.sha256(path.read_bytes()).hexdigest()
    usable = sorted({str(chunk["match"]) for chunk in all_chunks})
    report = {"matches": len(matches), "usable_matches": len(usable),
              "segments": len(all_chunks), "counts": dict(totals),
              "usable_seconds": totals["accepted"] / 20,
              "action_counts": action_counts(all_chunks)}
    if args.mode == "export":
        if args.output is None:
            parser.error("export requires --output")
        histograms = action_counts(all_chunks)
        if histograms["attack"]["1"] == 0 or histograms["move"]["4"] == totals["accepted"]:
            raise ValueError("demonstrations must include attacks and movement; idle captures are not training data")
        split = split_matches(usable, args.seed)
        args.output.mkdir(parents=True, exist_ok=False)
        for name in ("train", "validation", "test"):
            with (args.output / f"{name}.jsonl").open("w", encoding="utf-8") as stream:
                for chunk in all_chunks:
                    if split[str(chunk["match"])] == name:
                        stream.write(json.dumps(chunk, allow_nan=False) + "\n")
        manifest = {"schema": 2, "contract": CONTRACT_ID,
                    "contract_sha256": hashlib.sha256(CONTRACT.read_bytes()).hexdigest(),
                    "features": features(), "tick_hz": 20, "max_ack_age_ticks": 2,
                    "action": {"move": 9, "jump": 2, "sneak": 2, "sprint": 2, "attack": 2},
                    "kit": "trooper", "sword_slot": SWORD_SLOT, "combatants": args.combatants,
                    "seed": args.seed, "split": split, "sources_sha256": sources,
                    "provenance": "human-control-schema-3",
                    "files_sha256": {f"{name}.jsonl": hashlib.sha256(
                        (args.output / f"{name}.jsonl").read_bytes()).hexdigest()
                        for name in ("train", "validation", "test")},
                    "report": report}
        (args.output / "manifest.json").write_text(
            json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
