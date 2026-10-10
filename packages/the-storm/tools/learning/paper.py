"""Actual-Paper collection through the owner process's authenticated console client."""

from __future__ import annotations

import json
import math
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import torch
from torch import Tensor

from policy import WIRE, Policy, array, integer, mapping, observation
from ppo import ActorCritic, Episode, sample
from train import BudgetExpired


class Console(Protocol):
    def command(self, command: str) -> dict[str, object]: ...


class OwnerConsole:
    """Credentials stay in Bun's server owner; stdin/stdout carry only JSON commands/state."""

    def __init__(self) -> None:
        self.sequence = 0

    def command(self, command: str) -> dict[str, object]:
        self.sequence += 1
        print(json.dumps({"kind": "command", "id": self.sequence, "command": command}), flush=True)
        raw = sys.stdin.readline()
        if not raw:
            raise RuntimeError("Paper owner disconnected")
        response = mapping(json.loads(raw))
        if response.get("id") != self.sequence:
            raise ValueError("Paper owner response order mismatch")
        if "error" in response:
            if response["error"] in (
                "observation context expired",
                "stale, duplicate or wrong-context action",
                "duel no longer live",
            ):
                raise Discontinuity(str(response["error"]))
            raise RuntimeError(str(response["error"]))
        return mapping(response["state"])


@dataclass(frozen=True)
class OpponentFrame:
    body: str
    life: int
    tick: int
    observations: list[float] | None
    used: list[int]

    @classmethod
    def parse(cls, raw: dict[str, object], live: bool) -> OpponentFrame:
        required = set(array(WIRE["frameRequired"]))
        optional = set(array(WIRE["frameOptional"]))
        if not required.issubset(raw) or set(raw) - required - optional:
            raise ValueError("opponent frame fields differ from wire contract")
        body = raw["body"]
        if not isinstance(body, str) or str(UUID(body)) != body:
            raise ValueError("invalid historical body identity")
        life = integer(raw["life"], 0, 2**31 - 1)
        tick = integer(raw["tick"], 0, 2**63 - 1)
        used = [integer(value, 0, tick) for value in array(raw["used"])]
        if len(used) > 4 or used != sorted(set(used)):
            raise ValueError("invalid historical control acknowledgements")
        for name in ("applied", "fallback"):
            integer(raw[name], 0, 2**63 - 1)
        return cls(body, life, tick, observation(raw["observation"]) if live else None, used)


@dataclass(frozen=True)
class FrozenOpponent:
    actor: Policy
    weights_sha256: str


@dataclass(frozen=True)
class State:
    result: str
    phase: str
    match: str
    body: str
    life: int
    tick: int
    observations: list[float] | None
    dealt: float
    received: float
    used: list[int]
    opponent_frame: OpponentFrame | None

    @classmethod
    def parse(cls, raw: dict[str, object]) -> State:
        if raw.get("protocol") != WIRE["version"] or raw.get("contract") != WIRE["contract"]:
            raise ValueError("Paper protocol mismatch")
        required = set(array(WIRE["required"]))
        optional = set(array(WIRE["optional"]))
        if not required.issubset(raw) or set(raw) - required - optional:
            raise ValueError("Paper fields differ from wire contract")
        result = raw["result"]
        phase = raw["phase"]
        if result not in array(WIRE["results"]):
            raise ValueError("unknown duel result")
        if phase not in array(WIRE["phases"]):
            raise ValueError("unknown duel phase")
        if (
            raw["opponent"] not in array(WIRE["opponents"])
            or raw["mode"] not in ("authored", "external")
            or raw["side"] not in ("red", "blue")
        ):
            raise ValueError("invalid Paper duel configuration")
        match = raw["match"]
        body = raw.get("body", "")
        if not isinstance(match, str) or not isinstance(body, str):
            raise ValueError("invalid Paper identity")
        if match and str(UUID(match)) != match or body and str(UUID(body)) != body:
            raise ValueError("noncanonical Paper identity")
        life = integer(raw.get("life", 0), 0, 2**31 - 1)
        tick = integer(raw.get("tick", 0), 0, 2**63 - 1)
        if result == "live" and (
            not match or not body or integer(raw["sampleTick"], 0, 2**63 - 1) != tick
        ):
            raise ValueError("missing or mismatched live frame")
        metrics: list[float] = []
        for key in ("sampleDealt", "sampleReceived"):
            value = raw[key]
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                raise ValueError("invalid Paper reward totals")
            metrics.append(float(value))
        used = [integer(value, 0, tick) for value in array(raw["used"])]
        if len(used) > 4 or used != sorted(set(used)):
            raise ValueError("invalid applied-control acknowledgements")
        values = observation(raw["observation"]) if result == "live" else None
        opponent = None
        if "opponentFrame" in raw:
            if raw["opponent"] != "historical":
                raise ValueError("unexpected historical opponent frame")
            opponent = OpponentFrame.parse(mapping(raw["opponentFrame"]), result == "live")
        if (
            result == "live"
            and raw["opponent"] == "historical"
            and (opponent is None or opponent.tick != tick or opponent.body == body)
        ):
            raise ValueError("historical observations are not two coherent fair frames")
        assert isinstance(result, str) and isinstance(phase, str)
        return cls(
            result, phase, match, body, life, tick, values, metrics[0], metrics[1], used, opponent
        )


class Discontinuity(ValueError):
    """Censor this episode; never interpolate a missed tick or credit fallback controls."""


def wait(console: Console, predicate: Callable[[State], bool], deadline: float) -> State:
    while time.monotonic() < deadline:
        state = State.parse(console.command("state"))
        if predicate(state):
            return state
        time.sleep(0.005)
    raise BudgetExpired


def collect(
    console: Console,
    model: ActorCritic,
    generator: torch.Generator,
    seed: int,
    side: str,
    where: torch.device,
    deadline: float,
    opponent: str = "basic",
    historical: FrozenOpponent | None = None,
) -> tuple[Episode, dict[str, object]]:
    """Twenty-Hz queued actions; rewards are cut before any body acts at the next tick.

    Console responses introduce up to two ticks of actuation latency. This is
    part of the environment, rather than a claim that a decision already ran.
    Each decision receives actor loss only after Paper confirms its actual use.
    """
    if side not in ("red", "blue") or not 0 <= seed < 2**31:
        raise ValueError("invalid duel seed or side")
    if opponent not in array(WIRE["opponents"]):
        raise ValueError("unknown duel opponent")
    if (opponent == "historical") != (historical is not None):
        raise ValueError("historical duels require a frozen opponent")
    wait(console, lambda state: state.phase == "LOBBY", min(deadline, time.monotonic() + 30))
    console.command(f"begin {seed} {side} external {opponent}")
    started = time.monotonic()
    observations: list[Tensor] = []
    actions: list[Tensor] = []
    logs: list[Tensor] = []
    values: list[Tensor] = []
    rewards: list[float] = []
    ticks: list[int] = []
    confirmed: set[int] = set()
    inference_ms: list[float] = []
    historical_ticks: list[int] = []
    historical_confirmed: set[int] = set()
    historical_generator = torch.Generator().manual_seed(seed + 1_000_000_007)
    historical_hidden, historical_cell = model.actor.initial(1, torch.device("cpu"))
    model.eval()
    hidden, cell = model.actor.initial(1, where)
    try:
        state = wait(console, lambda item: item.result == "live", min(deadline, started + 15))
        identity = state.match, state.body, state.life
        historical_identity = (
            (state.opponent_frame.body, state.opponent_frame.life) if state.opponent_frame else None
        )
        while state.result == "live":
            if time.monotonic() >= deadline:
                raise BudgetExpired
            if (state.match, state.body, state.life) != identity:
                raise Discontinuity("Paper body, life or match changed")
            assert state.observations is not None
            obs = torch.tensor(state.observations, dtype=torch.float32, device=where)[None]
            before = time.monotonic()
            with torch.no_grad():
                output = model.forward(obs, hidden, cell)
                chosen, log_prob = sample(output.logits, generator)
            hidden, cell = output.hidden, output.cell
            action = [int(value) for value in chosen[0].tolist()]
            fields: list[str | int] = [state.match, state.body, state.life, state.tick, *action]
            if historical is not None:
                other = state.opponent_frame
                assert other is not None and other.observations is not None
                if (other.body, other.life) != historical_identity:
                    raise Discontinuity("historical body or life changed")
                with torch.no_grad():
                    frozen_output = historical.actor.forward(
                        torch.tensor(other.observations, dtype=torch.float32)[None],
                        historical_hidden,
                        historical_cell,
                    )
                    frozen_action, _ = sample(frozen_output.logits, historical_generator)
                historical_hidden, historical_cell = frozen_output.hidden, frozen_output.cell
                fields += [
                    state.match,
                    other.body,
                    other.life,
                    other.tick,
                    *map(int, frozen_action[0].tolist()),
                ]
                historical_ticks.append(other.tick)
            inference_ms.append((time.monotonic() - before) * 1000)
            console.command(" ".join(map(str, ["acts" if historical else "act", *fields])))
            following = wait(
                console,
                lambda item, previous_tick=state.tick: (
                    item.result != "live" or item.tick > previous_tick
                ),
                deadline,
            )
            if (
                not state.tick <= following.tick <= state.tick + 1
                or following.result == "live"
                and following.tick != state.tick + 1
            ):
                raise Discontinuity("Paper skipped a twenty-Hz observation")
            confirmed.update(following.used)
            if following.opponent_frame:
                historical_confirmed.update(following.opponent_frame.used)
            dealt = following.dealt - state.dealt
            received = following.received - state.received
            if dealt < 0 or received < 0:
                raise ValueError("Paper cumulative damage went backwards")
            reward = (dealt - received) / 20 - 0.001
            if following.result == "win":
                reward += 1
            elif following.result == "loss":
                reward -= 1
            observations.append(obs[0].cpu())
            actions.append(chosen[0].cpu())
            logs.append(log_prob[0].cpu())
            values.append(output.value[0].cpu())
            rewards.append(reward)
            ticks.append(state.tick)
            state = following
        if state.result not in ("win", "loss", "draw", "timeout"):
            raise Discontinuity("Paper duel was interrupted")
        # A submitted but never applied final decision is excluded from actor
        # loss. Its state/reward still trains the value function.
        episode = Episode(
            torch.stack(observations),
            torch.stack(actions),
            torch.stack(logs),
            torch.stack(values),
            torch.tensor(rewards),
            torch.tensor([float(tick in confirmed) for tick in ticks]),
            0,
        )
        return episode, {
            "engine": "Paper",
            "provenance": "automated-rollout",
            "seed": seed,
            "side": side,
            "opponent": opponent,
            "match": state.match,
            "result": state.result,
            "frames": len(ticks),
            "confirmed_controls": int(episode.controlled.sum().item()),
            "dealt": state.dealt,
            "received": state.received,
            "seconds": time.monotonic() - started,
            "max_inference_ms": max(inference_ms),
            "reward": sum(rewards),
            "historical_weights_sha256": historical.weights_sha256 if historical else None,
            "historical_confirmed_controls": sum(
                tick in historical_confirmed for tick in historical_ticks
            ),
        }
    finally:
        console.command("cancel")
