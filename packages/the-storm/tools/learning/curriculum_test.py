"""Curriculum ordering and immutable opponent provenance; no human demo fixtures."""

from __future__ import annotations

import io
import random
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

from curriculum import Curriculum, History
from paper import Discontinuity, FrozenOpponent, OwnerConsole, State, collect
from policy import FEATURES, Policy
from ppo import ActorCritic
from ppo_test import frame


class CurriculumTest(unittest.TestCase):
    def test_terminal_race_is_censored_but_malformed_requests_still_fail(self) -> None:
        for error, expected in (
            ("duel no longer live", Discontinuity),
            ("act requires an external live duel and nine fields", RuntimeError),
        ):
            with (
                self.subTest(error=error),
                patch("sys.stdin", io.StringIO('{"id":1,"error":"' + error + '"}\n')),
                patch("sys.stdout", io.StringIO()),
            ):
                with self.assertRaises(expected):
                    OwnerConsole().command("act")

        class EndedConsole:
            def __init__(self) -> None:
                self.commands: list[str] = []
                self.states = iter([{**frame(), "phase": "LOBBY", "result": "waiting"}, frame()])

            def command(self, command: str) -> dict[str, object]:
                self.commands.append(command)
                if command.startswith("act "):
                    raise Discontinuity("duel no longer live")
                return next(self.states) if command == "state" else frame()

        console = EndedConsole()
        with self.assertRaises(Discontinuity):
            collect(
                console,
                ActorCritic(Policy()),
                torch.Generator().manual_seed(3),
                3,
                "red",
                torch.device("cpu"),
                time.monotonic() + 30,
            )
        self.assertEqual(console.commands[-1], "cancel")

    def test_all_phases_require_updates_and_exercise_each_authored_style(self) -> None:
        course = Curriculum(0, 100, True)
        self.assertEqual(course.choose(99), "stationary")
        course.completed()
        for opponent in (
            "chase",
            "basic",
            "authored",
            "authored-pressure",
            "authored-patient",
            "historical",
        ):
            self.assertEqual(course.choose(99), opponent)
            course.completed()
        self.assertEqual(course.counts, [1, 2, 3, 1])
        self.assertTrue(course.complete())

    def test_real_curriculum_preserves_fixed_time_windows_and_never_skips_phases(self) -> None:
        course = Curriculum(0, 100)
        course.completed()
        self.assertEqual(course.choose(9), "stationary")
        self.assertEqual(course.choose(10), "chase")
        course.completed()
        self.assertEqual(course.choose(90), "basic")
        course.completed()
        self.assertEqual(course.choose(90), "authored")
        self.assertFalse(course.complete())

    def test_historical_actor_is_hash_pinned_detached_and_immune_to_current_updates(self) -> None:
        actor = Policy()
        with tempfile.TemporaryDirectory() as folder:
            history = History(Path(folder), "synthetic-diagnostic", 3)
            history.freeze(actor, 0, "bc")
            original = actor.head.weight.detach().clone()
            with torch.no_grad():
                actor.head.weight.add_(1)
            chosen = history.select(random.Random(3))
            torch.testing.assert_close(chosen.actor.head.weight, original, rtol=0, atol=0)
            self.assertTrue(
                all(not parameter.requires_grad for parameter in chosen.actor.parameters())
            )
            (history.entries[0] / "weights.pt").write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                history.select(random.Random(3))

    def test_historical_collection_uses_each_fair_vector_and_atomic_paired_actions(self) -> None:
        historical_observations = [0.25] * len(FEATURES)

        def paired(tick: int) -> dict[str, object]:
            return {
                **frame(tick),
                "opponent": "historical",
                "opponentFrame": {
                    "body": "00000000-0000-0000-0000-000000000003",
                    "life": 0,
                    "tick": tick,
                    "used": [10] if tick > 10 else [],
                    "applied": 1,
                    "fallback": 0,
                    "observation": historical_observations,
                },
            }

        class PairedConsole:
            def __init__(self) -> None:
                self.commands: list[str] = []
                self.states = iter(
                    [
                        {**frame(), "phase": "LOBBY", "result": "waiting"},
                        paired(10),
                        paired(11),
                        {**paired(12), "result": "win", "phase": "ENDED"},
                    ]
                )

            def command(self, command: str) -> dict[str, object]:
                self.commands.append(command)
                return next(self.states) if command == "state" else frame()

        class WatchingPolicy(Policy):
            def __init__(self) -> None:
                super().__init__()
                self.inputs: list[torch.Tensor] = []
                self.memories: list[torch.Tensor] = []

            def forward(self, obs: torch.Tensor, hidden: torch.Tensor, cell: torch.Tensor):
                self.inputs.append(obs.detach().clone())
                self.memories.append(hidden.detach().clone())
                return super().forward(obs, hidden, cell)

        actor = WatchingPolicy().eval().requires_grad_(False)
        for _ in range(2):
            console = PairedConsole()
            episode, report = collect(
                console,
                ActorCritic(Policy()),
                torch.Generator().manual_seed(3),
                3,
                "red",
                torch.device("cpu"),
                time.monotonic() + 30,
                "historical",
                FrozenOpponent(actor, "a" * 64),
            )
            torch.testing.assert_close(episode.observations, torch.zeros(2, len(FEATURES)))
            self.assertEqual(report["historical_confirmed_controls"], 1)
            paired_commands = [
                command for command in console.commands if command.startswith("acts ")
            ]
            self.assertEqual(len(paired_commands), 2)
            self.assertEqual(len(paired_commands[0].split()), 19)
        self.assertEqual(len(actor.inputs), 4)
        for obs in actor.inputs:
            torch.testing.assert_close(obs, torch.full((1, len(FEATURES)), 0.25))
        for memory in (actor.memories[0], actor.memories[2]):
            self.assertEqual(float(memory.abs().sum().item()), 0)

    def test_two_body_protocol_rejects_mixed_ticks_and_identity(self) -> None:
        raw = {
            **frame(),
            "opponent": "historical",
            "opponentFrame": {
                "body": "00000000-0000-0000-0000-000000000003",
                "life": 0,
                "tick": 11,
                "used": [],
                "applied": 0,
                "fallback": 0,
                "observation": [0.0] * len(FEATURES),
            },
        }
        with self.assertRaisesRegex(ValueError, "coherent"):
            State.parse(raw)


if __name__ == "__main__":
    unittest.main()
