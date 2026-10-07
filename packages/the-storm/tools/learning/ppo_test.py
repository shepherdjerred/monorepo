"""Independent math and state checks; synthetic fixtures are not demonstration data."""

from __future__ import annotations

import random
import tempfile
import time
import unittest
from pathlib import Path

import torch

from data import Dataset, Sequence
from paper import Discontinuity, State, collect
from policy import FEATURES, HEADS, Policy, load_checkpoint, write_checkpoint
from ppo import (
    ActorCritic,
    Episode,
    Settings,
    advantages,
    policy_objective,
    probabilities,
    replay_prefix,
    sample,
    update,
    window,
)
from train import BudgetExpired


def make_episode(model: ActorCritic, length: int = 12) -> Episode:
    generator = torch.Generator().manual_seed(23)
    observations = torch.rand(length, len(FEATURES), generator=generator)
    hidden, cell = model.actor.initial(1, torch.device("cpu"))
    actions, logs, values, rewards = [], [], [], []
    with torch.no_grad():
        for obs in observations:
            output = model.forward(obs[None], hidden, cell)
            chosen, log = sample(output.logits, generator)
            hidden, cell = output.hidden, output.cell
            actions.append(chosen[0])
            logs.append(log[0])
            values.append(output.value[0])
            rewards.append(float(chosen[0, 0] == 7))
    return Episode(
        observations,
        torch.stack(actions),
        torch.stack(logs),
        torch.stack(values),
        torch.tensor(rewards),
        torch.ones(length),
        0,
    )


def frame(tick: int = 10) -> dict[str, object]:
    return {
        "protocol": 2,
        "contract": "rwf-combat-v1",
        "seed": 3,
        "side": "red",
        "mode": "external",
        "opponent": "basic",
        "dealt": 0,
        "received": 0,
        "applied": 0,
        "fallback": 0,
        "result": "live",
        "phase": "LIVE",
        "match": "00000000-0000-0000-0000-000000000001",
        "body": "00000000-0000-0000-0000-000000000002",
        "life": 0,
        "tick": tick,
        "sampleTick": tick,
        "sampleDealt": 0,
        "sampleReceived": 0,
        "used": [],
        "observation": [0.0] * len(FEATURES),
    }


class PpoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        torch.set_num_threads(1)

    def test_joint_log_probability_and_entropy(self) -> None:
        logits = torch.zeros(3, sum(HEADS.values()))
        actions = torch.tensor([[7, 0, 0, 1, 1]] * 3)
        log, entropy = probabilities(logits, actions)
        expected = torch.log(torch.tensor(9 * 2**4, dtype=torch.float32))
        torch.testing.assert_close(log, -expected.expand(3))
        torch.testing.assert_close(entropy, expected.expand(3))

    def test_positive_and_negative_advantages_are_clipped_and_padding_has_no_gradient(self) -> None:
        # Positive advantage caps an increased probability at 1.2. Negative
        # advantage caps a decreased probability at 0.8, not 1.2.
        new = torch.log(torch.tensor([1.5, 0.5, 2.0])).requires_grad_()
        objective, _, _ = policy_objective(
            new, torch.zeros(3), torch.tensor([1.0, -1.0, 7.0]), torch.tensor([1.0, 1.0, 0.0]), 0.2
        )
        self.assertAlmostEqual(float(objective.item()), -0.2, places=6)
        objective.backward()
        assert new.grad is not None
        torch.testing.assert_close(new.grad, torch.zeros(3))

    def test_gae_matches_discounted_returns_and_distinguishes_bootstrap(self) -> None:
        model = ActorCritic(Policy())
        original = make_episode(model, 3)
        episode = Episode(
            original.observations,
            original.actions,
            original.old_log_prob,
            torch.tensor([0.3, 0.4, 0.5]),
            torch.tensor([1.0, 2.0, 3.0]),
            torch.ones(3),
            0,
        )
        settings = Settings(gamma=0.5, gae_lambda=1)
        advantage, returns = advantages(episode, settings)
        torch.testing.assert_close(returns, torch.tensor([2.75, 3.5, 3.0]))
        torch.testing.assert_close(advantage, returns - episode.old_value)
        bootstrapped = Episode(
            episode.observations,
            episode.actions,
            episode.old_log_prob,
            episode.old_value,
            episode.rewards,
            episode.controlled,
            2,
        )
        torch.testing.assert_close(
            advantages(bootstrapped, settings)[1], torch.tensor([3.0, 4.0, 4.0])
        )

    def test_prefix_replays_current_weights_and_resets_between_episodes(self) -> None:
        torch.manual_seed(4)
        model = ActorCritic(Policy())
        obs = torch.rand(9, len(FEATURES))
        full, _ = window(model, obs, 0, 9)
        tail, _ = window(model, obs, 5, 9)
        torch.testing.assert_close(tail, full[5:])
        with torch.no_grad():
            model.actor.encoder.weight.add_(0.1)
        changed, _ = window(model, obs, 0, 9)
        changed_tail, _ = window(model, obs, 5, 9)
        torch.testing.assert_close(changed_tail, changed[5:])
        self.assertFalse(torch.allclose(changed_tail, tail))
        hidden, cell = replay_prefix(model.actor, obs, 0)
        self.assertEqual(float(hidden.abs().sum().item() + cell.abs().sum().item()), 0)

    def test_update_uses_only_human_training_split_and_preserves_unaccepted_kind(self) -> None:
        torch.manual_seed(5)
        model = ActorCritic(Policy())
        episodes = [make_episode(model)]
        demonstrations = Dataset(
            [Sequence(episodes[0].observations, torch.tensor([[7, 0, 0, 1, 1]] * 12))],
            [Sequence(torch.full((2, len(FEATURES)), float("nan")), torch.zeros(2, 5))],
            [],
            "synthetic-diagnostic",
        )
        original = model.actor.head.weight.detach().clone()
        optimizer = torch.optim.Adam(model.parameters(), lr=0.003)
        report = update(
            model,
            optimizer,
            episodes,
            demonstrations,
            Settings(epochs=2, unroll=4),
            random.Random(3),
            torch.device("cpu"),
            time.monotonic() + 30,
        )
        updated = report["windows_updated"]
        assert isinstance(updated, int)
        self.assertGreater(updated, 0)
        self.assertFalse(torch.equal(original, model.actor.head.weight))
        self.assertEqual(report["imitation_split"], "train")
        self.assertFalse(report["test_used_for_selection"])
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "checkpoint"
            write_checkpoint(model.actor, out, report, "rwf-trooper-ppo")
            restored, manifest = load_checkpoint(out)
            self.assertEqual(manifest["kind"], "rwf-trooper-ppo")
            self.assertEqual(manifest["acceptance"], "unaccepted")
            torch.testing.assert_close(restored.head.weight, model.actor.head.weight)

    def test_budget_expiry_does_not_run_an_optimizer_step(self) -> None:
        model = ActorCritic(Policy())
        episode = make_episode(model)
        demonstrations = Dataset(
            [Sequence(episode.observations, episode.actions)], [], [], "synthetic"
        )
        original = model.actor.head.weight.detach().clone()
        with self.assertRaises(BudgetExpired):
            update(
                model,
                torch.optim.Adam(model.parameters()),
                [episode],
                demonstrations,
                Settings(),
                random.Random(1),
                torch.device("cpu"),
                time.monotonic() - 1,
            )
        torch.testing.assert_close(original, model.actor.head.weight, rtol=0, atol=0)

    def test_paper_frame_clock_and_applied_contexts_are_validated(self) -> None:
        state = State.parse(frame())
        self.assertEqual(state.tick, 10)
        for altered in (
            {"sampleTick": 11},
            {"used": [9, 8]},
            {"sampleDealt": float("nan")},
            {"body": "other"},
            {"observation": [True] * len(FEATURES)},
        ):
            with self.assertRaises(ValueError):
                State.parse({**frame(), **altered})

    def test_collect_censors_a_skipped_tick_and_cancels_exact_duel(self) -> None:
        class SkippingConsole:
            def __init__(self, terminal: bool) -> None:
                self.commands: list[str] = []
                self.reads = 0
                self.terminal = terminal

            def command(self, command: str) -> dict[str, object]:
                self.commands.append(command)
                if command == "state":
                    self.reads += 1
                    if self.reads == 1:
                        return {**frame(), "phase": "LOBBY", "result": "waiting"}
                    if self.reads == 2:
                        return frame(10)
                    return {**frame(12), "result": "win"} if self.terminal else frame(12)
                return frame()

        for terminal in (False, True):
            with self.subTest(terminal=terminal):
                console = SkippingConsole(terminal)
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

    def test_native_reward_includes_terminal_damage_and_excludes_unapplied_actor_decisions(
        self,
    ) -> None:
        class CompletedConsole:
            def __init__(self) -> None:
                self.commands: list[str] = []
                self.frames = iter(
                    [
                        {**frame(), "phase": "LOBBY", "result": "waiting"},
                        frame(10),
                        {**frame(11), "sampleDealt": 4, "sampleReceived": 2, "used": [10]},
                        {
                            **frame(12),
                            "result": "win",
                            "phase": "ENDED",
                            "sampleDealt": 20,
                            "sampleReceived": 2,
                            "used": [10],
                        },
                    ]
                )

            def command(self, command: str) -> dict[str, object]:
                self.commands.append(command)
                return next(self.frames) if command == "state" else frame()

        console = CompletedConsole()
        episode, report = collect(
            console,
            ActorCritic(Policy()),
            torch.Generator().manual_seed(3),
            3,
            "red",
            torch.device("cpu"),
            time.monotonic() + 30,
        )
        torch.testing.assert_close(episode.rewards, torch.tensor([0.099, 1.799]))
        torch.testing.assert_close(episode.controlled, torch.tensor([1.0, 0.0]))
        self.assertAlmostEqual(float(episode.rewards.sum().item()), 1.898, places=6)
        self.assertEqual(report["confirmed_controls"], 1)
        self.assertEqual(console.commands[-1], "cancel")


if __name__ == "__main__":
    unittest.main()
