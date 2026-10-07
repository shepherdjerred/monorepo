"""Evaluation never selects outcomes by dropping/retrying late control frames."""

from __future__ import annotations

import time
import unittest

import torch

from evaluate import Matchup, run_duel, schedule, validate_training
from paper import Discontinuity
from policy import Policy
from ppo_test import frame


class EvaluationConsole:
    def __init__(self, result: str = "loss", reject: bool = False, gap: int = 1) -> None:
        self.commands: list[str] = []
        self.reject = reject
        self.states = iter(
            [
                {**frame(), "phase": "LOBBY", "result": "waiting"},
                frame(10),
                {**frame(10 + gap), "used": [10]},
                {
                    **frame(11 + gap),
                    "phase": "ENDED",
                    "result": result,
                    "dealt": 2,
                    "received": 20,
                    "used": [10],
                    "applied": 1,
                    "fallback": 3,
                },
            ]
        )

    def command(self, command: str) -> dict[str, object]:
        self.commands.append(command)
        if command.startswith("act ") and self.reject:
            raise Discontinuity("duel no longer live")
        return next(self.states) if command == "state" else frame()


class WatchingPolicy(Policy):
    def __init__(self) -> None:
        super().__init__()
        self.memories: list[torch.Tensor] = []

    def forward(self, obs: torch.Tensor, hidden: torch.Tensor, cell: torch.Tensor):
        self.memories.append(hidden.detach().clone())
        return super().forward(obs, hidden, cell)


class EvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        torch.set_num_threads(1)

    def test_missing_ticks_retain_the_loss_and_reset_memory_without_retry(self) -> None:
        actor = WatchingPolicy().eval().requires_grad_(False)
        original = {key: value.clone() for key, value in actor.state_dict().items()}
        console = EvaluationConsole(gap=3)
        report = run_duel(
            console,
            actor,
            Matchup("basic", 3, "red"),
            17,
            torch.device("cpu"),
            time.monotonic() + 30,
        )
        self.assertEqual(report["result"], "loss")
        self.assertEqual(report["missed_ticks"], 2)
        self.assertEqual(report["memory_resets"], 1)
        self.assertEqual(report["authored_fallbacks"], 3)
        self.assertEqual(report["dealt"], 2)
        self.assertEqual(report["received"], 20)
        self.assertEqual(sum(command.startswith("begin ") for command in console.commands), 1)
        self.assertEqual(console.commands[-1], "cancel")
        for memory in actor.memories:
            torch.testing.assert_close(memory, torch.zeros_like(memory), rtol=0, atol=0)
        for key, value in actor.state_dict().items():
            torch.testing.assert_close(value, original[key], rtol=0, atol=0)

    def test_terminal_action_race_counts_outcome_and_does_not_rerun(self) -> None:
        console = EvaluationConsole("win", reject=True)
        report = run_duel(
            console,
            Policy().eval().requires_grad_(False),
            Matchup("basic", 3, "red"),
            17,
            torch.device("cpu"),
            time.monotonic() + 30,
        )
        self.assertEqual(report["result"], "win")
        self.assertEqual(report["rejected_actions"], 2)
        self.assertEqual(report["submitted_controls"], 0)
        self.assertEqual(sum(command.startswith("begin ") for command in console.commands), 1)

    def test_interruption_fails_and_cancels_instead_of_selecting_a_fresh_duel(self) -> None:
        console = EvaluationConsole("cancelled")
        with self.assertRaisesRegex(ValueError, "interrupted"):
            run_duel(
                console,
                Policy(),
                Matchup("basic", 3, "red"),
                17,
                torch.device("cpu"),
                time.monotonic() + 30,
            )
        self.assertEqual(console.commands[-1], "cancel")
        self.assertEqual(sum(command.startswith("begin ") for command in console.commands), 1)

    def test_schedule_uses_both_sides_and_opponents_once(self) -> None:
        matches = schedule(200, 500000000)
        self.assertEqual(len(matches), 400)
        self.assertEqual(len(set(matches)), 400)
        self.assertEqual(
            matches[:2],
            [Matchup("authored", 500000000, "red"), Matchup("authored", 500000000, "blue")],
        )
        self.assertEqual(matches[200], Matchup("basic", 500000000, "red"))
        for count in (1, 3, 201, 202):
            with self.assertRaises(ValueError):
                schedule(count, 0)

    def test_pilot_rejects_diagnostic_provenance_selection_and_training_seed_overlap(self) -> None:
        # Contract-only metadata fixture, never a recording or training input.
        training: dict[str, object] = {
            "seed": 17,
            "provenance": "human-bc-plus-paper-ppo",
            "dataset_sha256": "a" * 64,
            "test_used_for_selection": False,
            "pilot_acceptance_checked": False,
            "curriculum": {"complete": True},
            "games": [{"seed": 17}],
        }
        manifest: dict[str, object] = {"kind": "rwf-trooper-ppo", "training": training}
        matchups = schedule(200, 500000000)
        validate_training(manifest, 17, False, matchups)
        for changed in (
            {"provenance": "diagnostic-paper-pipeline"},
            {"dataset_sha256": "synthetic-diagnostic"},
            {"test_used_for_selection": True},
            {"curriculum": {"complete": False}},
            {"games": [{"seed": 500000000}]},
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_training(
                    {**manifest, "training": {**training, **changed}}, 17, False, matchups
                )
        with self.assertRaisesRegex(ValueError, "this seed"):
            validate_training(manifest, 18, False, matchups)


if __name__ == "__main__":
    unittest.main()
