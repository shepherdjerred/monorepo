"""Fixed-action codec tests; no human or trained-policy acceptance evidence."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import torch

from native.idle_actor import ACTIONS, generate, idle_policy
from policy import FEATURES, HEADS, load_checkpoint


class IdleActorTest(unittest.TestCase):
    def test_actions_stay_fixed_across_observations_and_recurrent_states(self) -> None:
        torch.set_num_threads(1)
        torch.manual_seed(43)
        model = idle_policy()
        hidden = torch.randn(20, 128)
        cell = torch.randn_like(hidden)
        for _ in range(16):
            sample = model(torch.rand(20, len(FEATURES)) * 2 - 1, hidden, cell)
            heads = sample.logits.split(tuple(HEADS.values()), dim=-1)
            for name, head in zip(HEADS, heads, strict=True):
                self.assertEqual(head.argmax(-1).tolist(), [ACTIONS[name]] * 20)
            hidden, cell = sample.hidden, sample.cell
        self.assertEqual(ACTIONS, {"move": 4, "jump": 1, "sneak": 0, "sprint": 0, "attack": 0})

    def test_export_keeps_diagnostic_provenance_and_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "idle"
            result = generate(output)
            _, manifest = load_checkpoint(output / "checkpoint")
            self.assertEqual(result["acceptance"], "unaccepted")
            self.assertEqual(result["diagnostic"], True)
            self.assertEqual(
                manifest["training"],
                {
                    "provenance": "diagnostic-native-window",
                    "training_run": False,
                    "human_demonstrations_used": False,
                    "actions": ACTIONS,
                },
            )
            with self.assertRaises(FileExistsError):
                generate(output)
