"""Behavior-clone continuous Trooper segments; select checkpoints on validation only."""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import Tensor

from data import Dataset, Sequence, batch
from policy import Policy, device, loss, write_checkpoint


@dataclass(frozen=True)
class Settings:
    epochs: int
    batch_size: int
    unroll: int
    learning_rate: float
    max_seconds: float
    seed: int

    def __post_init__(self) -> None:
        if (
            not 1 <= self.epochs <= 1000
            or not 1 <= self.batch_size <= 128
            or not 1 <= self.unroll <= 256
            or not 0 <= self.seed < 2**31
            or not math.isfinite(self.learning_rate)
            or not 0 < self.learning_rate <= 0.1
            or not math.isfinite(self.max_seconds)
            or not 0 < self.max_seconds <= 8 * 3600
        ):
            raise ValueError("invalid or over-budget BC settings")


def rollout(
    model: Policy, obs: Tensor, hidden: Tensor, cell: Tensor
) -> tuple[Tensor, Tensor, Tensor]:
    logits: list[Tensor] = []
    for tick in range(obs.shape[1]):
        output = model.forward(obs[:, tick], hidden, cell)
        hidden, cell = output.hidden, output.cell
        logits.append(output.logits)
    return torch.stack(logits, dim=1), hidden, cell


class BudgetExpired(Exception):
    """Cooperative wall-clock stop at a recurrent window boundary."""


def score(
    model: Policy,
    sequences: list[Sequence],
    where: torch.device,
    settings: Settings,
    deadline: float | None = None,
) -> float:
    model.eval()
    total, count = 0.0, 0.0
    with torch.no_grad():
        for offset in range(0, len(sequences), settings.batch_size):
            obs, actions, mask = batch(sequences[offset : offset + settings.batch_size], where)
            hidden, cell = model.initial(obs.shape[0], where)
            for start in range(0, obs.shape[1], settings.unroll):
                if deadline is not None and time.monotonic() >= deadline:
                    raise BudgetExpired
                end = start + settings.unroll
                logits, hidden, cell = rollout(model, obs[:, start:end], hidden, cell)
                samples = float(mask[:, start:end].sum().item())
                total += (
                    float(loss(logits, actions[:, start:end], mask[:, start:end]).item()) * samples
                )
                count += samples
    if count == 0 or not math.isfinite(total):
        raise ValueError("invalid validation score")
    return total / count


def fit(
    dataset: Dataset, settings: Settings, where: torch.device
) -> tuple[Policy, dict[str, object]]:
    """Truncated BPTT carries memory through a segment and resets at every gap/match."""
    torch.manual_seed(settings.seed)
    randomizer = random.Random(settings.seed)
    model = Policy().to(where)
    optimizer = torch.optim.Adam(model.parameters(), lr=settings.learning_rate)
    began = time.monotonic()
    deadline = began + settings.max_seconds
    try:
        best = score(model, dataset.validation, where, settings, deadline)
    except BudgetExpired as error:
        raise ValueError("budget expired before initial validation completed") from error
    best_state = copy.deepcopy(model.state_dict())
    history: list[dict[str, float | int]] = []
    completed = 0
    expired = False
    for epoch in range(settings.epochs):
        model.train()
        segments = dataset.train.copy()
        randomizer.shuffle(segments)
        for offset in range(0, len(segments), settings.batch_size):
            if time.monotonic() >= deadline:
                expired = True
                break
            obs, actions, mask = batch(segments[offset : offset + settings.batch_size], where)
            hidden, cell = model.initial(obs.shape[0], where)
            for start in range(0, obs.shape[1], settings.unroll):
                if time.monotonic() >= deadline:
                    expired = True
                    break
                end = start + settings.unroll
                optimizer.zero_grad(set_to_none=True)
                logits, hidden, cell = rollout(model, obs[:, start:end], hidden, cell)
                objective = loss(logits, actions[:, start:end], mask[:, start:end])
                if not torch.isfinite(objective):
                    raise ValueError("nonfinite training objective")
                objective.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
                optimizer.step()
                hidden, cell = hidden.detach(), cell.detach()
            if expired:
                break
        if expired:
            break
        try:
            validation = score(model, dataset.validation, where, settings, deadline)
        except BudgetExpired:
            expired = True
            break
        completed = epoch + 1
        history.append({"epoch": completed, "validation_nll": validation})
        print(json.dumps(history[-1], allow_nan=False), flush=True)
        if validation < best:
            best, best_state = validation, copy.deepcopy(model.state_dict())
    model.load_state_dict(best_state, strict=True)
    model.eval()
    return model.cpu(), {
        "algorithm": "behavior-cloning",
        "dataset_sha256": dataset.fingerprint,
        "seed": settings.seed,
        "epochs_completed": completed,
        "epochs_requested": settings.epochs,
        "batch_size": settings.batch_size,
        "unroll": settings.unroll,
        "learning_rate": settings.learning_rate,
        "budget_seconds": settings.max_seconds,
        "elapsed_seconds": time.monotonic() - began,
        "expired": expired,
        "best_validation_nll": best,
        "history": history,
        "test_used_for_selection": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", required=True, choices=("cpu", "mps"))
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--unroll", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--max-seconds", type=float, default=3600)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be new; preserve frozen checkpoints")
    settings = Settings(
        args.epochs, args.batch_size, args.unroll, args.learning_rate, args.max_seconds, args.seed
    )
    dataset = Dataset.load(args.dataset)
    model, metadata = fit(dataset, settings, device(args.device))
    write_checkpoint(model, args.output, metadata)


if __name__ == "__main__":
    main()
