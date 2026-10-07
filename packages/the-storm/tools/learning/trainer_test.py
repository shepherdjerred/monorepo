"""Training mechanics tests use synthetic fixtures, never human demonstrations."""

from __future__ import annotations

import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import torch

from data import Dataset, Sequence, batch
from export import export
from policy import (
    FEATURES,
    HEADS,
    Policy,
    digest,
    load_checkpoint,
    loss,
    observation,
    write_checkpoint,
)
from train import BudgetExpired, Settings, fit, rollout, score

ROOT = Path(__file__).resolve().parents[2]


def synthetic_sequence(length: int = 12) -> Sequence:
    obs = torch.zeros(length, len(FEATURES))
    obs[:, FEATURES.index("HP")] = 1
    obs[:, FEATURES.index("TARGET_KNOWN")] = 1
    obs[:, FEATURES.index("SLOT")] = 1 / 8
    return Sequence(obs, torch.tensor([[7, 0, 0, 1, 1]] * length))


def export_fixture(root: Path) -> Path:
    recordings = root / "recordings"
    recordings.mkdir()
    obs = synthetic_sequence(4).observations[0].tolist()
    for index in range(10):
        match = str(UUID(int=index + 1))
        rows = [
            f"H\t3\t{match}\ttraining-yard\tcontent\t7\trwf-combat-1",
            "R\tp1\tRED\ttrooper\tfalse",
            "R\tp2\tBLUE\ttrooper\ttrue",
        ]
        for tick in range(4):
            rows.extend(
                [
                    f"O\t{tick}\tp1\trwf-combat-v1\t" + "\t".join(map(str, obs)),
                    f"F\t{tick}\tp1\t100\t2080\t100\t0\t0\t80\t1\t0",
                    f"N\t{tick}\tp1\t65\t0\t0\ttrue\tfalse\t1\t{tick}\t{tick}\tHUMAN",
                ]
            )
        rows.append("X\t4\tRED\tLAST_TEAM_STANDING")
        with gzip.open(recordings / f"{match}.rwfrec.gz", "wt", encoding="utf-8") as stream:
            stream.write("\n".join(rows) + "\n")
    out = root / "data"
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/bots/learning/dataset.py"),
            "export",
            str(recordings),
            "--output",
            str(out),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return out


class TrainerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        torch.set_num_threads(1)

    def test_exported_split_integrity_and_match_isolation(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            out = export_fixture(Path(folder))
            data = Dataset.load(out)
            self.assertEqual([len(data.train), len(data.validation), len(data.test)], [8, 1, 1])
            path = out / "train.jsonl"
            original = path.read_text(encoding="utf-8")
            path.write_text(original + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "digest"):
                Dataset.load(out)
            lines = [json.loads(line) for line in original.splitlines()]
            other = json.loads((out / "test.jsonl").read_text(encoding="utf-8"))
            lines[0]["match"] = other["match"]
            path.write_text("\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8")
            manifest_path = out / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files_sha256"]["train.jsonl"] = digest(path)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "leaked"):
                Dataset.load(out)

    def test_padding_contributes_no_gradient(self) -> None:
        obs, actions, mask = batch(
            [synthetic_sequence(2), synthetic_sequence(5)], torch.device("cpu")
        )
        self.assertEqual(tuple(obs.shape), (2, 5, len(FEATURES)))
        logits = torch.randn(2, 5, sum(HEADS.values()), requires_grad=True)
        loss(logits, actions, mask).backward()
        self.assertIsNotNone(logits.grad)
        grad = logits.grad
        assert grad is not None
        self.assertEqual(float(grad[0, 2:].abs().sum().item()), 0)
        self.assertGreater(float(grad[1].abs().sum().item()), 0)

    def test_batched_memory_is_independent_and_reset_reproduces_first_action(self) -> None:
        torch.manual_seed(3)
        model = Policy()
        obs = torch.rand(2, 8, len(FEATURES))
        hidden, cell = model.initial(2, torch.device("cpu"))
        together, _, _ = rollout(model, obs, hidden, cell)
        for index in range(2):
            h, c = model.initial(1, torch.device("cpu"))
            separate, _, _ = rollout(model, obs[index : index + 1], h, c)
            torch.testing.assert_close(together[index : index + 1], separate)
        h, c = model.initial(2, torch.device("cpu"))
        reset = model.forward(obs[:, 0], h, c)
        torch.testing.assert_close(reset.logits, together[:, 0])

    def test_bc_learns_without_consulting_test_sequences(self) -> None:
        data = Dataset(
            [synthetic_sequence()],
            [synthetic_sequence()],
            [synthetic_sequence()],
            "synthetic-diagnostic",
        )
        settings = Settings(12, 1, 4, 0.01, 30, 3)
        torch.manual_seed(3)
        before = score(Policy(), data.validation, torch.device("cpu"), settings)
        data.test[0].observations.fill_(float("nan"))
        model, report = fit(data, settings, torch.device("cpu"))
        after = score(model, data.validation, torch.device("cpu"), settings)
        self.assertLess(after, before * 0.3)
        self.assertFalse(report["test_used_for_selection"])
        self.assertEqual(report["epochs_completed"], 12)

    def test_checkpoint_corruption_is_rejected_and_outputs_survive_reload(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "checkpoint"
            model = Policy()
            write_checkpoint(model, out, {"provenance": "synthetic-diagnostic"})
            restored, manifest = load_checkpoint(out)
            self.assertEqual(manifest["acceptance"], "unaccepted")
            obs = torch.zeros(1, len(FEATURES))
            h, c = model.initial(1, torch.device("cpu"))
            torch.testing.assert_close(
                model.forward(obs, h, c).logits, restored.forward(obs, h, c).logits
            )
            with (out / "weights.pt").open("ab") as stream:
                stream.write(b"corrupt")
            with self.assertRaisesRegex(ValueError, "digest"):
                load_checkpoint(out)

    def test_expired_budget_preserves_last_validated_checkpoint(self) -> None:
        data = Dataset([synthetic_sequence()], [synthetic_sequence()], [], "synthetic-diagnostic")
        settings = Settings(2, 1, 4, 0.01, 30, 3)
        torch.manual_seed(settings.seed)
        original = Policy()
        # Initial validation, one training window, then expiry. No unvalidated
        # update may replace the saved checkpoint, including during validation.
        with patch("train.time.monotonic", side_effect=[0, 0, 0, 0, 0, 0, 31, 31]):
            restored, report = fit(data, settings, torch.device("cpu"))
        self.assertTrue(report["expired"])
        self.assertEqual(report["epochs_completed"], 0)
        for name, value in original.state_dict().items():
            torch.testing.assert_close(value, restored.state_dict()[name], rtol=0, atol=0)
        with patch("train.time.monotonic", return_value=31):
            with self.assertRaises(BudgetExpired):
                score(original, data.validation, torch.device("cpu"), settings, deadline=30)

    def test_recurrent_onnx_parity_and_dynamic_batches(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            write_checkpoint(Policy(), root / "checkpoint", {"provenance": "synthetic-diagnostic"})
            report = export(root / "checkpoint", root / "onnx")
            parity = report["parity"]
            assert isinstance(parity, dict)
            self.assertLess(parity["max_abs_error"], 1e-5)
            self.assertEqual(parity["batches"], [1, 3, 20, 100])

    def test_invalid_observations_and_over_budget_settings_are_rejected(self) -> None:
        for bad in (
            [0] * (len(FEATURES) - 1),
            [float("nan")] * len(FEATURES),
            [2] * len(FEATURES),
            [True] * len(FEATURES),
        ):
            with self.assertRaises(ValueError):
                observation(bad)
        with self.assertRaises(ValueError):
            Settings(1, 1, 64, 0.001, 8 * 3600 + 1, 3)


if __name__ == "__main__":
    unittest.main()
