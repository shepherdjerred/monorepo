"""Frozen actual-Paper strength evaluation; no optimization or outcome-dependent retries."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

import torch

from map_selection.plan import MapBinding, read_maps, validate_maps
from paper import Console, Discontinuity, OwnerConsole, State, wait
from policy import FEATURES, Policy, array, device, digest, integer, load_checkpoint, mapping
from ppo import sample

CONTRACT = mapping(json.loads(Path(__file__).with_name("evaluation.json").read_text()))
if CONTRACT != {
    "version": 2,
    "mapSelection": "balanced-contiguous-pairs",
    "matchesPerOpponent": 200,
    "firstSeed": 500000000,
    "opponents": ["authored", "basic"],
    "sides": ["red", "blue"],
    "minimumWins": {"authored": 120, "basic": 160},
    "reportFields": [
        "version",
        "engine",
        "mode",
        "acceptance",
        "actor_seed",
        "weights_sha256",
        "manifest_sha256",
        "maps",
        "games",
        "optimized",
        "retried_duels",
        "blind_preference_checked",
        "pilot_acceptance_checked",
    ],
    "gameFields": [
        "map",
        "blocksSha256",
        "scenarioSha256",
        "engine",
        "opponent",
        "seed",
        "side",
        "match",
        "result",
        "frames",
        "submitted_controls",
        "confirmed_controls",
        "applied_controls",
        "authored_fallbacks",
        "missed_ticks",
        "rejected_actions",
        "memory_resets",
        "dealt",
        "received",
        "seconds",
        "max_inference_ms",
    ],
}:
    raise ValueError("unsupported strength evaluation contract")


@dataclass(frozen=True)
class Matchup:
    opponent: str
    seed: int
    side: str
    map: MapBinding


def schedule(matches: int, first_seed: int, raw_maps: list[MapBinding]) -> list[Matchup]:
    integer(matches, 2, 200)
    integer(first_seed, 0, 1_000_000_000)
    if matches % 2:
        raise ValueError("evaluation must pair both sides")
    # The same environment seeds and sides are used for every learned seed
    # and opponent. Controller randomness is private to each exact matchup.
    maps = validate_maps([entry.report() for entry in raw_maps])
    pairs = matches // 2
    if pairs < len(maps):
        raise ValueError("evaluation cannot cover every admitted map on both sides")
    return [
        Matchup(opponent, first_seed + index, side, binding)
        for map_index, binding in enumerate(maps)
        for opponent in ("authored", "basic")
        for index in range(pairs)
        if index * len(maps) // pairs == map_index
        for side in ("red", "blue")
    ]


def validate_training(
    manifest: dict[str, object], seed: int, diagnostic: bool, matchups: list[Matchup]
) -> None:
    training = mapping(manifest["training"])
    trained_maps = validate_maps(training.get("maps"))
    evaluated_maps = list(dict.fromkeys(matchup.map for matchup in matchups))
    if diagnostic:
        if any(binding not in trained_maps for binding in evaluated_maps):
            raise ValueError("diagnostic maps differ from training terrain or scenarios")
    elif trained_maps != evaluated_maps or training.get("map_coverage_complete") is not True:
        raise ValueError("evaluation maps differ from the complete trained catalog")
    if manifest["kind"] != "rwf-trooper-ppo" or training.get("seed") != seed:
        raise ValueError("evaluation needs the frozen PPO actor for this seed")
    dataset_sha = training.get("dataset_sha256")
    if not diagnostic and (
        training.get("provenance") != "human-bc-plus-paper-ppo"
        or training.get("test_used_for_selection") is not False
        or training.get("pilot_acceptance_checked") is not False
        or mapping(training.get("curriculum")).get("complete") is not True
        or not isinstance(dataset_sha, str)
        or re.fullmatch("[a-f0-9]{64}", dataset_sha) is None
    ):
        raise ValueError("pilot evaluation requires the complete human-training curriculum")
    training_seeds = {
        integer(mapping(game)["seed"], 0, 2**31 - 1) for game in array(training.get("games"))
    }
    if any(matchup.seed in training_seeds for matchup in matchups):
        raise ValueError("frozen evaluation seeds overlap training")


def run_duel(
    console: Console,
    actor: Policy,
    matchup: Matchup,
    actor_seed: int,
    where: torch.device,
    deadline: float,
) -> dict[str, object]:
    wait(console, lambda state: state.phase == "LOBBY", min(deadline, time.monotonic() + 30))
    console.command(f"begin {matchup.seed} {matchup.side} external {matchup.opponent}")
    started = time.monotonic()
    generator = torch.Generator().manual_seed(
        actor_seed * 2_000_000_002 + matchup.seed * 2 + int(matchup.side == "blue")
    )
    hidden, cell = actor.initial(1, where)
    requests: set[int] = set()
    confirmed: set[int] = set()
    frames, gaps, rejected, resets = 0, 0, 0, 0
    inference_ms: list[float] = []
    try:
        state = wait(console, lambda item: item.result == "live", min(deadline, started + 15))
        identity = state.match, state.body, state.life
        terminal: dict[str, object] | None = None
        while state.result == "live":
            if (state.match, state.body, state.life) != identity:
                raise ValueError("evaluation body, life or match changed")
            assert state.observations is not None
            before = time.monotonic()
            with torch.inference_mode():
                output = actor.forward(
                    torch.tensor(state.observations, dtype=torch.float32, device=where)[None],
                    hidden,
                    cell,
                )
                chosen, _ = sample(output.logits, generator)
            hidden, cell = output.hidden, output.cell
            actions = list(map(int, chosen[0].tolist()))
            inference_ms.append((time.monotonic() - before) * 1000)
            frames += 1
            try:
                # Rejections from expected expiration/terminal races are
                # observed, never followed by a rerun of this duel.
                raw = console.command(
                    " ".join(
                        map(str, ["act", state.match, state.body, state.life, state.tick, *actions])
                    )
                )
                requests.add(state.tick)
                confirmed.update(State.parse(raw).used)
            except Discontinuity:
                rejected += 1

            raw = console.command("state")
            following = State.parse(raw)
            while following.result == "live" and following.tick == state.tick:
                if time.monotonic() >= deadline:
                    raise TimeoutError("evaluation deadline expired during a duel")
                time.sleep(0.005)
                raw = console.command("state")
                following = State.parse(raw)
            if (
                raw["seed"] != matchup.seed
                or raw["side"] != matchup.side
                or (raw["opponent"] != matchup.opponent or raw["mode"] != "external")
            ):
                raise ValueError("evaluation configuration changed")
            if time.monotonic() >= deadline:
                raise TimeoutError("evaluation deadline expired during a duel")
            if following.match != identity[0] or following.tick < state.tick:
                raise ValueError("evaluation match or clock changed")
            confirmed.update(following.used)
            missed = max(0, following.tick - state.tick - 1)
            gaps += missed
            if missed or (rejected and state.tick not in requests):
                hidden, cell = actor.initial(1, where)
                resets += 1
            state = following
            terminal = raw
        if state.result not in ("win", "loss", "draw", "timeout") or terminal is None:
            raise ValueError("evaluation duel interrupted; do not retry or discard its outcome")
        report = {
            **matchup.map.report(),
            "engine": "Paper",
            "opponent": matchup.opponent,
            "seed": matchup.seed,
            "side": matchup.side,
            "match": state.match,
            "result": state.result,
            "frames": frames,
            "submitted_controls": len(requests),
            "confirmed_controls": len(requests & confirmed),
            "applied_controls": integer(terminal["applied"], 0, 2**63 - 1),
            "authored_fallbacks": integer(terminal["fallback"], 0, 2**63 - 1),
            "missed_ticks": gaps,
            "rejected_actions": rejected,
            "memory_resets": resets,
            "dealt": terminal["dealt"],
            "received": terminal["received"],
            "seconds": time.monotonic() - started,
            "max_inference_ms": max(inference_ms),
        }
        validate_fields(report, "gameFields")
        return report
    finally:
        console.command("cancel")


def emit(kind: str, report: dict[str, object]) -> None:
    print(json.dumps({"kind": kind, "report": report}, allow_nan=False), flush=True)


def validate_fields(report: dict[str, object], field: str) -> None:
    if set(report) != set(array(CONTRACT[field])):
        raise ValueError("strength report fields differ from the neutral contract")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "mps"), required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--maps", type=Path, required=True)
    parser.add_argument("--matches", type=int, required=True)
    parser.add_argument("--first-seed", type=int, required=True)
    parser.add_argument("--deadline-ms", type=float, required=True)
    parser.add_argument("--diagnostic", action="store_true")
    args = parser.parse_args()
    if (
        args.output.exists()
        or not math.isfinite(args.deadline_ms)
        or args.deadline_ms / 1000 <= time.time() + 15
        or not 0 <= args.seed <= 1_000_000_000
        or (args.diagnostic and args.matches > 4)
        or (not args.diagnostic and args.matches != CONTRACT["matchesPerOpponent"])
        or (not args.diagnostic and args.first_seed != CONTRACT["firstSeed"])
    ):
        parser.error("invalid frozen evaluation settings or existing output")
    maps = read_maps(args.maps)
    matchups = schedule(args.matches, args.first_seed, maps)
    deadline = time.monotonic() + args.deadline_ms / 1000 - time.time() - 15
    torch.set_num_threads(1)
    actor, manifest = load_checkpoint(args.checkpoint)
    weights_sha = digest(args.checkpoint / "weights.pt")
    manifest_sha = digest(args.checkpoint / "manifest.json")
    validate_training(manifest, args.seed, args.diagnostic, matchups)
    where = device(args.device)
    actor = actor.to(where).eval().requires_grad_(False)
    hidden, cell = actor.initial(1, where)
    warm_generator = torch.Generator().manual_seed(0)
    with torch.inference_mode():
        for _ in range(8):
            output = actor.forward(torch.zeros(1, len(FEATURES), device=where), hidden, cell)
            sample(output.logits, warm_generator)[0].cpu()
            hidden, cell = output.hidden, output.cell
    args.output.mkdir(parents=True, exist_ok=False)
    emit("ready", {"mode": "frozen-evaluation", "weights_sha256": weights_sha})
    console = OwnerConsole()
    games: list[dict[str, object]] = []
    selected: MapBinding | None = None
    with (args.output / "games.jsonl").open("x", encoding="utf-8") as stream:
        for matchup in matchups:
            if matchup.map != selected:
                wait(
                    console,
                    lambda state: state.phase == "LOBBY",
                    min(deadline, time.monotonic() + 30),
                )
                if MapBinding.parse(console.command(f"map {matchup.map.map}")) != matchup.map:
                    raise ValueError("Paper selected a different evaluation map")
                selected = matchup.map
            if time.monotonic() >= deadline:
                raise TimeoutError("evaluation deadline expired while preparing a map")
            game = run_duel(console, actor, matchup, args.seed, where, deadline)
            games.append(game)
            stream.write(json.dumps(game, allow_nan=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
            emit("episode", game)
    if (
        digest(args.checkpoint / "weights.pt") != weights_sha
        or digest(args.checkpoint / "manifest.json") != manifest_sha
    ):
        raise ValueError("frozen checkpoint changed during evaluation")
    report: dict[str, object] = {
        "version": 2,
        "engine": "Paper",
        "mode": "diagnostic" if args.diagnostic else "pilot",
        "acceptance": "unaccepted",
        "actor_seed": args.seed,
        "weights_sha256": weights_sha,
        "manifest_sha256": manifest_sha,
        "maps": [entry.report() for entry in maps],
        "games": games,
        "optimized": False,
        "retried_duels": 0,
        "blind_preference_checked": False,
        "pilot_acceptance_checked": False,
    }
    validate_fields(report, "reportFields")
    (args.output / "report.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    emit("complete", {"games": len(games), "optimized": False})


if __name__ == "__main__":
    main()
