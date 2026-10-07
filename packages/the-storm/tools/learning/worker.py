"""Owner-driven Paper PPO worker; genuine datasets are required outside diagnostic mode."""

from __future__ import annotations

import argparse
import contextlib
import copy
import json
import math
import random
import sys
import time
from pathlib import Path

import torch

from curriculum import STAGES, Curriculum, History
from data import Dataset, Sequence
from paper import Discontinuity, OwnerConsole, collect
from policy import FEATURES, device, digest, load_checkpoint, mapping, write_checkpoint
from ppo import ActorCritic, Settings, sample, update
from train import BudgetExpired, fit
from train import Settings as BcSettings


def emit(kind: str, report: dict[str, object]) -> None:
    print(json.dumps({"kind": kind, "report": report}, allow_nan=False), flush=True)


def synthetic() -> Dataset:
    obs = torch.zeros(12, len(FEATURES))
    obs[:, FEATURES.index("HP")] = 1
    obs[:, FEATURES.index("TARGET_KNOWN")] = 1
    obs[:, FEATURES.index("SLOT")] = 1 / 8
    sequence = Sequence(obs, torch.tensor([[7, 0, 0, 1, 1]] * 12))
    return Dataset([sequence], [sequence], [], "synthetic-diagnostic")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", required=True, choices=("cpu", "mps"))
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--max-seconds", type=float, default=3600)
    parser.add_argument("--deadline-ms", type=float, required=True)
    parser.add_argument("--curriculum", action="store_true")
    parser.add_argument("--updates", type=int, default=100000)
    parser.add_argument("--episodes", type=int, default=4)
    parser.add_argument(
        "--opponent",
        choices=(
            "stationary",
            "chase",
            "basic",
            "authored",
            "authored-pressure",
            "authored-patient",
        ),
        default="basic",
    )
    parser.add_argument("--diagnostic", action="store_true")
    args = parser.parse_args()
    if (
        not 0 <= args.seed <= 1_000_000_000
        or not 0 < args.max_seconds <= 8 * 3600
        or not 1 <= args.updates <= 100000
        or not 2 <= args.episodes <= 32
        or args.episodes % 2
        or args.output.exists()
        or not math.isfinite(args.deadline_ms)
    ):
        parser.error("invalid settings, budget or existing output")
    if args.diagnostic and (
        args.dataset
        or args.checkpoint
        or args.max_seconds > 300
        or args.updates != (7 if args.curriculum else 1)
    ):
        parser.error(
            "diagnostic requires one update (seven with curriculum), "
            "at most 300 seconds, and no human inputs"
        )
    if not args.diagnostic and args.dataset is None:
        parser.error("a genuine human dataset is required")
    began = time.monotonic()
    remaining = min(args.max_seconds, args.deadline_ms / 1000 - time.time())
    # Reserve serialization time inside the owner's hard budget. Its watchdog
    # terminates this process at the absolute deadline, even if imports hung.
    if remaining <= 15:
        parser.error("owner budget expired before worker initialization")
    deadline = began + remaining - 15
    where = device(args.device)
    torch.set_num_threads(1)
    torch.manual_seed(args.seed)
    generator = torch.Generator().manual_seed(args.seed)
    randomizer = random.Random(args.seed)
    history_randomizer = random.Random(args.seed + 1_000_000_007)
    data = synthetic() if args.diagnostic else Dataset.load(args.dataset)
    args.output.mkdir(parents=True, exist_ok=False)
    if args.checkpoint:
        actor, manifest = load_checkpoint(args.checkpoint)
        if (
            manifest["kind"] != "rwf-trooper-bc"
            or mapping(manifest["training"]).get("dataset_sha256") != data.fingerprint
        ):
            raise ValueError("initial BC checkpoint must match this human dataset")
        initial_sha = digest(args.checkpoint / "weights.pt")
    else:
        with contextlib.redirect_stdout(sys.stderr):
            actor, training = fit(
                data,
                BcSettings(
                    12 if args.diagnostic else 30,
                    1 if args.diagnostic else 8,
                    64,
                    0.01 if args.diagnostic else 0.001,
                    min(3600, deadline - time.monotonic()),
                    args.seed,
                ),
                where,
            )
        training["provenance"] = (
            "synthetic-diagnostic" if args.diagnostic else "human-control-schema-3"
        )
        write_checkpoint(actor, args.output / "initial-bc", training)
        initial_sha = digest(args.output / "initial-bc/weights.pt")
    model = ActorCritic(actor).to(where)
    optimizer = torch.optim.Adam(model.parameters(), lr=Settings().learning_rate)
    # Warm the selected device before the first observation. Do not lose a
    # game tick to lazy accelerator initialization or sampling setup.
    hidden, cell = model.actor.initial(1, where)
    warm_generator = torch.Generator().manual_seed(0)
    with torch.no_grad():
        for _ in range(8):
            result = model.forward(torch.zeros(1, len(FEATURES), device=where), hidden, cell)
            chosen, log_prob = sample(result.logits, warm_generator)
            chosen.cpu()
            log_prob.cpu()
            result.value.cpu()
            hidden, cell = result.hidden, result.cell
    emit(
        "ready", {"diagnostic": args.diagnostic, "device": args.device, "dataset": data.fingerprint}
    )
    console = OwnerConsole()
    # This handshake waits for the owner's Paper boot before allocating the
    # remaining PPO window. Boot and BC are still charged to the outer budget.
    console.command("state")
    curriculum = Curriculum(time.monotonic(), deadline, args.diagnostic)
    history = History(args.output / "history", data.fingerprint, args.seed)
    if args.curriculum:
        history.freeze(model.actor, 0, "bc")
    games: list[dict[str, object]] = []
    updates: list[dict[str, object]] = []
    censored: list[str] = []
    attempts, consecutive_censored = 0, 0
    expired = False
    try:
        while len(updates) < args.updates and time.monotonic() < deadline:
            previous_stage = curriculum.stage
            opponent = curriculum.choose(time.monotonic()) if args.curriculum else args.opponent
            if args.curriculum and curriculum.stage != previous_stage:
                history.freeze(model.actor, len(updates), STAGES[previous_stage])
            episodes = []
            historical = None
            while len(episodes) < args.episodes:
                seed = args.seed + len(games) // 2
                side = "red" if len(games) % 2 == 0 else "blue"
                attempts += 1
                if opponent == "historical" and len(episodes) % 2 == 0:
                    historical = history.select(history_randomizer)
                try:
                    episode, report = collect(
                        console, model, generator, seed, side, where, deadline, opponent, historical
                    )
                except Discontinuity as error:
                    censored.append(str(error))
                    consecutive_censored += 1
                    emit("censored", {"reason": str(error), "attempts": attempts})
                    if consecutive_censored >= 3:
                        raise RuntimeError(
                            "three consecutive censored duels; repair collection timing"
                        ) from error
                    continue
                consecutive_censored = 0
                episodes.append(episode)
                games.append(report)
                with (args.output / "rollouts.jsonl").open("a", encoding="utf-8") as stream:
                    stream.write(
                        json.dumps(
                            {
                                "report": report,
                                "observations": episode.observations.tolist(),
                                "actions": episode.actions.tolist(),
                                "old_log_prob": episode.old_log_prob.tolist(),
                                "old_value": episode.old_value.tolist(),
                                "rewards": episode.rewards.tolist(),
                                "controlled": episode.controlled.tolist(),
                            },
                            allow_nan=False,
                        )
                        + "\n"
                    )
                emit("episode", report)
            before_update = copy.deepcopy(model.state_dict())
            try:
                report = update(
                    model, optimizer, episodes, data, Settings(), randomizer, where, deadline
                )
            except BudgetExpired:
                model.load_state_dict(before_update, strict=True)
                raise
            updates.append(report)
            if args.curriculum:
                curriculum.completed()
                if len(updates) % 25 == 0:
                    history.freeze(model.actor, len(updates), STAGES[curriculum.stage])
            emit("update", report)
    except BudgetExpired:
        expired = True
    if time.monotonic() >= deadline:
        expired = True
    if args.diagnostic and not updates:
        raise ValueError("diagnostic must complete a real-Paper PPO update")
    report: dict[str, object] = {
        "algorithm": "recurrent-ppo-with-imitation",
        "engine": "Paper",
        "provenance": "diagnostic-paper-pipeline" if args.diagnostic else "human-bc-plus-paper-ppo",
        "dataset_sha256": data.fingerprint,
        "initial_bc_weights_sha256": initial_sha,
        "seed": args.seed,
        "budget_seconds": args.max_seconds,
        "owner_deadline_ms": args.deadline_ms,
        "elapsed_seconds": time.monotonic() - began,
        "expired": expired,
        "games": games,
        "updates": updates,
        "censored": censored,
        "imitation_split": "train",
        "test_used_for_selection": False,
        "pilot_acceptance_checked": False,
        "curriculum": curriculum.report() if args.curriculum else None,
        "historical_snapshots": len(history.entries),
    }
    write_checkpoint(model.actor, args.output / "final", report, "rwf-trooper-ppo")
    (args.output / "report.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    emit(
        "complete",
        {
            "games": len(games),
            "updates": len(updates),
            "expired": expired,
            "curriculum_complete": curriculum.complete() if args.curriculum else None,
        },
    )


if __name__ == "__main__":
    main()
