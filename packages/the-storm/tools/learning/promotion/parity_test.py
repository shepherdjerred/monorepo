"""Exact export parity rejects substituted checkpoints and inaccurate graphs."""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnx
import torch

from export import export
from policy import Policy, array, digest, mapping, write_checkpoint
from promotion.parity import prepare, verify


class ParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = tempfile.TemporaryDirectory()
        cls.root = Path(cls.fixture.name)
        torch.set_num_threads(1)
        torch.manual_seed(71)
        cls.checkpoint = cls.root / "checkpoint"
        cls.actor = cls.root / "actor"
        write_checkpoint(Policy(), cls.checkpoint, {"provenance": "unit-parity"}, "rwf-trooper-ppo")
        export(cls.checkpoint, cls.actor)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.fixture.cleanup()

    def test_existing_actor_is_copied_exactly_and_bound_to_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "evidence"
            prepare(self.checkpoint, self.actor, output)
            samples = mapping(json.loads((output / "samples.json").read_text("utf-8")))
            for name in ("actor.onnx", "manifest.json"):
                self.assertEqual(
                    (output / "onnx" / name).read_bytes(), (self.actor / name).read_bytes()
                )
            self.assertEqual(samples["weights_sha256"], digest(self.checkpoint / "weights.pt"))
            self.assertEqual(samples["actor_manifest_sha256"], digest(self.actor / "manifest.json"))
            self.assertEqual(
                samples["checkpoint_manifest_sha256"], digest(self.checkpoint / "manifest.json")
            )
            self.assertEqual(samples["schema"], 2)
            sample_file = output / "samples.json"
            original = sample_file.read_bytes()
            result = verify(self.checkpoint, self.actor, sample_file)
            self.assertEqual(result, {"samples_sha256": digest(sample_file)})
            self.assertEqual(sample_file.read_bytes(), original)
            with self.assertRaises(FileExistsError):
                prepare(self.checkpoint, self.actor, output)

    def test_different_checkpoint_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            torch.manual_seed(72)
            checkpoint = root / "different"
            write_checkpoint(Policy(), checkpoint, {"provenance": "unit-parity"}, "rwf-trooper-ppo")
            with self.assertRaisesRegex(ValueError, "exact unaccepted PPO checkpoint"):
                prepare(checkpoint, self.actor, root / "evidence")

    def test_corrupt_graph_is_rejected_before_samples_are_published(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            actor = root / "actor"
            shutil.copytree(self.actor, actor)
            (actor / "actor.onnx").write_bytes(b"invalid")
            with self.assertRaisesRegex(ValueError, "exact unaccepted PPO checkpoint"):
                prepare(self.checkpoint, actor, root / "evidence")
            self.assertFalse((root / "evidence/samples.json").exists())

    def test_valid_but_inaccurate_graph_fails_actual_recurrent_replay(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            actor = root / "actor"
            shutil.copytree(self.actor, actor)
            graph = onnx.load(str(actor / "actor.onnx"))
            weight = next(item for item in graph.graph.initializer if item.name == "head.weight")
            weight.CopyFrom(
                onnx.numpy_helper.from_array(
                    np.zeros_like(onnx.numpy_helper.to_array(weight)), name=weight.name
                )
            )
            onnx.save(graph, str(actor / "actor.onnx"))
            manifest = mapping(json.loads((actor / "manifest.json").read_text("utf-8")))
            manifest["onnx_sha256"] = digest(actor / "actor.onnx")
            (actor / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(AssertionError):
                prepare(self.checkpoint, actor, root / "evidence")
            self.assertFalse((root / "evidence/samples.json").exists())

    def test_unknown_export_metadata_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            actor = root / "actor"
            shutil.copytree(self.actor, actor)
            manifest = mapping(json.loads((actor / "manifest.json").read_text("utf-8")))
            manifest["unexpected"] = True
            (actor / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exact unaccepted PPO checkpoint"):
                prepare(self.checkpoint, actor, root / "evidence")

    def test_changed_archived_outputs_schedule_and_fields_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "evidence"
            prepare(self.checkpoint, self.actor, root)
            file = root / "samples.json"
            original = file.read_text("utf-8")
            for field, value in (("logits", 1000), ("observation", 0), ("hidden", "invalid")):
                raw = mapping(json.loads(original))
                cases = array(raw["cases"])
                case = mapping(cases[0])
                steps = array(case["steps"])
                step = mapping(steps[0])
                rows = array(step[field])
                row = array(rows[0])
                row[0] = value
                file.write_text(json.dumps(raw), encoding="utf-8")
                with self.assertRaises((ValueError, AssertionError)):
                    verify(self.checkpoint, self.actor, file)
            file.write_text(original, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
