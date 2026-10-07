"""Recurrent clipped PPO over actual-Paper episodes, with human training-split imitation."""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from typing import NamedTuple

import torch
from torch import Tensor, nn

from data import Dataset, Sequence
from policy import FEATURES, HEADS, HIDDEN, Policy, loss
from train import BudgetExpired, rollout


class Step(NamedTuple):
    logits: Tensor
    value: Tensor
    hidden: Tensor
    cell: Tensor


class ActorCritic(nn.Module):
    def __init__(self, actor: Policy) -> None:
        super().__init__()
        self.actor = actor
        self.critic = nn.Linear(HIDDEN, 1)

    def forward(self, obs: Tensor, hidden: Tensor, cell: Tensor) -> Step:
        output = self.actor.forward(obs, hidden, cell)
        return Step(
            output.logits, self.critic(output.hidden).squeeze(-1), output.hidden, output.cell
        )


def probabilities(logits: Tensor, actions: Tensor) -> tuple[Tensor, Tensor]:
    """The action is a joint sample of five independent categorical heads."""
    logs: list[Tensor] = []
    entropies: list[Tensor] = []
    for index, head in enumerate(logits.split(tuple(HEADS.values()), dim=-1)):
        log = head.log_softmax(-1)
        logs.append(log.gather(-1, actions[..., index : index + 1]).squeeze(-1))
        entropies.append(-(log.exp() * log).sum(-1))
    return torch.stack(logs).sum(0), torch.stack(entropies).sum(0)


def sample(logits: Tensor, generator: torch.Generator) -> tuple[Tensor, Tensor]:
    # Use a private CPU generator on either accelerator; do not share global
    # sampling state with unrelated matches or rely on MPS generator support.
    actions = torch.cat(
        [
            torch.multinomial(head.detach().cpu().softmax(-1), 1, generator=generator)
            for head in logits.split(tuple(HEADS.values()), dim=-1)
        ],
        dim=-1,
    ).to(logits.device)
    return actions, probabilities(logits, actions)[0]


@dataclass(frozen=True)
class Episode:
    observations: Tensor
    actions: Tensor
    old_log_prob: Tensor
    old_value: Tensor
    rewards: Tensor
    controlled: Tensor
    bootstrap: float

    def __post_init__(self) -> None:
        length = self.observations.shape[0]
        if (
            length < 2
            or self.observations.shape != (length, len(FEATURES))
            or self.actions.shape != (length, len(HEADS))
            or any(
                value.shape != (length,)
                for value in (self.old_log_prob, self.old_value, self.rewards, self.controlled)
            )
            or not math.isfinite(self.bootstrap)
        ):
            raise ValueError("invalid PPO episode shape")
        if self.actions.dtype != torch.long or any(
            not ((self.actions[:, index] >= 0) & (self.actions[:, index] < size)).all()
            for index, size in enumerate(HEADS.values())
        ):
            raise ValueError("invalid PPO actions")
        if (self.observations.abs() > 1).any() or (self.old_log_prob > 0).any():
            raise ValueError("invalid PPO observations or log probabilities")
        if any(
            value.requires_grad
            for value in (
                self.observations,
                self.old_log_prob,
                self.old_value,
                self.rewards,
                self.controlled,
            )
        ):
            raise ValueError("behavior rollout tensors must be detached")
        if any(
            not torch.isfinite(value).all()
            for value in (
                self.observations,
                self.old_log_prob,
                self.old_value,
                self.rewards,
                self.controlled,
            )
        ):
            raise ValueError("nonfinite PPO episode")
        if not ((self.controlled == 0) | (self.controlled == 1)).all():
            raise ValueError("invalid control mask")


@dataclass(frozen=True)
class Settings:
    epochs: int = 4
    unroll: int = 64
    learning_rate: float = 0.0003
    gamma: float = 0.99
    gae_lambda: float = 0.95
    clip: float = 0.2
    value_weight: float = 0.5
    entropy_weight: float = 0.01
    imitation_weight: float = 0.1
    target_kl: float = 0.02

    def __post_init__(self) -> None:
        floats = (
            self.learning_rate,
            self.gamma,
            self.gae_lambda,
            self.clip,
            self.value_weight,
            self.entropy_weight,
            self.imitation_weight,
            self.target_kl,
        )
        if (
            not 1 <= self.epochs <= 16
            or not 1 <= self.unroll <= 256
            or not all(math.isfinite(value) for value in floats)
            or not 0 < self.learning_rate <= 0.01
            or not 0 < self.gamma <= 1
            or not 0 <= self.gae_lambda <= 1
            or not 0 < self.clip < 1
            or not 0 < self.value_weight <= 1
            or not 0 <= self.entropy_weight <= 0.1
            or not 0 < self.imitation_weight <= 10
            or not 0 < self.target_kl <= 1
        ):
            raise ValueError("invalid PPO settings")


def advantages(episode: Episode, settings: Settings) -> tuple[Tensor, Tensor]:
    """GAE bootstraps only a genuine truncation; finite-horizon duel endings use zero."""
    advantage = torch.zeros_like(episode.rewards)
    following = episode.bootstrap
    carry = 0.0
    for index in reversed(range(len(episode.rewards))):
        current = float(episode.old_value[index].item())
        delta = float(episode.rewards[index].item()) + settings.gamma * following - current
        carry = delta + settings.gamma * settings.gae_lambda * carry
        advantage[index] = carry
        following = current
    return advantage, advantage + episode.old_value


def policy_objective(
    new_log_prob: Tensor, old_log_prob: Tensor, advantage: Tensor, mask: Tensor, clip: float
) -> tuple[Tensor, Tensor, Tensor]:
    log_ratio = new_log_prob - old_log_prob
    ratio = log_ratio.exp()
    unclipped = ratio * advantage
    clipped = ratio.clamp(1 - clip, 1 + clip) * advantage
    denominator = mask.sum().clamp_min(1)
    objective = -(torch.minimum(unclipped, clipped) * mask).sum() / denominator
    kl = (((ratio - 1) - log_ratio) * mask).sum() / denominator
    fraction = (((ratio - 1).abs() > clip).float() * mask).sum() / denominator
    return objective, kl, fraction


def replay_prefix(model: Policy, observations: Tensor, start: int) -> tuple[Tensor, Tensor]:
    """Recompute memory with CURRENT weights; stored behavior-policy states become stale."""
    hidden, cell = model.initial(1, observations.device)
    with torch.no_grad():
        for tick in range(start):
            output = model.forward(observations[tick : tick + 1], hidden, cell)
            hidden, cell = output.hidden, output.cell
    return hidden, cell


def window(model: ActorCritic, observations: Tensor, start: int, end: int) -> tuple[Tensor, Tensor]:
    hidden, cell = replay_prefix(model.actor, observations, start)
    logits: list[Tensor] = []
    values: list[Tensor] = []
    for tick in range(start, end):
        output = model.forward(observations[tick : tick + 1], hidden, cell)
        hidden, cell = output.hidden, output.cell
        logits.append(output.logits[0])
        values.append(output.value[0])
    return torch.stack(logits), torch.stack(values)


def imitation(
    model: Policy, sequence: Sequence, randomizer: random.Random, unroll: int, where: torch.device
) -> Tensor:
    length = sequence.observations.shape[0]
    start = randomizer.randrange(length)
    end = min(length, start + unroll)
    observations = sequence.observations.to(where)
    hidden, cell = replay_prefix(model, observations, start)
    logits, _, _ = rollout(model, observations[None, start:end], hidden, cell)
    return loss(
        logits,
        sequence.actions[None, start:end].to(where),
        torch.ones(1, end - start, device=where),
    )


def update(
    model: ActorCritic,
    optimizer: torch.optim.Optimizer,
    episodes: list[Episode],
    demonstrations: Dataset,
    settings: Settings,
    randomizer: random.Random,
    where: torch.device,
    deadline: float,
) -> dict[str, object]:
    if not episodes or not demonstrations.train:
        raise ValueError("PPO requires actual episodes and training-split demonstrations")
    targets = [advantages(episode, settings) for episode in episodes]
    chosen = torch.cat(
        [
            target[0][episode.controlled.bool()]
            for episode, target in zip(episodes, targets, strict=True)
        ]
    )
    if chosen.numel() < 2:
        raise ValueError("not enough confirmed external controls")
    mean, scale = chosen.mean(), chosen.std(unbiased=False).clamp_min(1e-8)
    normalized = [(target[0] - mean) / scale for target in targets]
    windows = [
        (index, start, min(len(episode.rewards), start + settings.unroll))
        for index, episode in enumerate(episodes)
        for start in range(0, len(episode.rewards), settings.unroll)
    ]
    model.train()
    completed, count = 0, 0
    stopped = False
    maximum_kl = 0.0
    totals = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "imitation_nll": 0.0}
    for epoch in range(settings.epochs):
        randomizer.shuffle(windows)
        for index, start, end in windows:
            if time.monotonic() >= deadline:
                raise BudgetExpired
            episode = episodes[index]
            observations = episode.observations.to(where)
            logits, values = window(model, observations, start, end)
            log_prob, entropy = probabilities(logits, episode.actions[start:end].to(where))
            mask = episode.controlled[start:end].to(where)
            policy, kl, _ = policy_objective(
                log_prob,
                episode.old_log_prob[start:end].to(where),
                normalized[index][start:end].to(where),
                mask,
                settings.clip,
            )
            measured_kl = float(kl.detach().item())
            maximum_kl = max(maximum_kl, measured_kl)
            if measured_kl > settings.target_kl:
                stopped = True
                break
            old_value = episode.old_value[start:end].to(where)
            returns = targets[index][1][start:end].to(where)
            clipped_value = old_value + (values - old_value).clamp(-settings.clip, settings.clip)
            value = (
                0.5
                * torch.maximum(
                    (values - returns).square(), (clipped_value - returns).square()
                ).mean()
            )
            entropy_mean = (entropy * mask).sum() / mask.sum().clamp_min(1)
            clone = imitation(
                model.actor,
                randomizer.choice(demonstrations.train),
                randomizer,
                settings.unroll,
                where,
            )
            objective = (
                policy
                + settings.value_weight * value
                - settings.entropy_weight * entropy_mean
                + settings.imitation_weight * clone
            )
            if not torch.isfinite(objective):
                raise ValueError("nonfinite PPO objective")
            optimizer.zero_grad(set_to_none=True)
            objective.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            optimizer.step()
            count += 1
            for key, item in zip(totals, (policy, value, entropy_mean, clone), strict=True):
                totals[key] += float(item.detach().item())
        if stopped:
            break
        completed = epoch + 1
    model.eval()
    return {
        "windows_updated": count,
        "epochs_completed": completed,
        "kl_stopped": stopped,
        "max_approximate_kl": maximum_kl,
        **{key: total / max(1, count) for key, total in totals.items()},
        "confirmed_controls": chosen.numel(),
        "test_used_for_selection": False,
        "imitation_split": "train",
    }
