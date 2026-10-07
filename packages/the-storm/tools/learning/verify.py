"""Verify BC and export mechanics on synthetic data, never an accepted combat policy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from data import Dataset, Sequence
from export import export
from policy import FEATURES, HIDDEN, Policy, device, write_checkpoint
from train import Settings, fit, score


def verify(name: str, output: Path) -> dict[str, object]:
    where = device(name)
    output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(1)
    observations = torch.zeros(12, len(FEATURES))
    observations[:, FEATURES.index("HP")] = 1
    observations[:, FEATURES.index("TARGET_KNOWN")] = 1
    observations[:, FEATURES.index("SLOT")] = 1 / 8
    sequence = Sequence(observations, torch.tensor([[7, 0, 0, 1, 1]] * 12))
    data = Dataset([sequence], [sequence], [], "synthetic-diagnostic")
    settings = Settings(12, 1, 4, 0.01, 60, 3)
    torch.manual_seed(settings.seed)
    before = score(Policy().to(where), data.validation, where, settings)
    model, training = fit(data, settings, where)
    after = score(model, data.validation, torch.device("cpu"), settings)
    if after >= before * 0.3:
        raise ValueError("synthetic BC learning check failed")
    training["provenance"] = "synthetic-diagnostic"
    write_checkpoint(model, output / "checkpoint", training)

    # A trained accelerator checkpoint must preserve recurrent outputs on CPU.
    accelerator = Policy().to(where)
    accelerator.load_state_dict(model.state_dict(), strict=True)
    accelerator.eval()
    generator = torch.Generator().manual_seed(41)
    obs = torch.rand(3, 16, len(FEATURES), generator=generator) * 2 - 1
    cpu_h, cpu_c = model.initial(3, torch.device("cpu"))
    other_h, other_c = accelerator.initial(3, where)
    maximum = 0.0
    with torch.no_grad():
        for tick in range(obs.shape[1]):
            expected = model.forward(obs[:, tick], cpu_h, cpu_c)
            actual = accelerator.forward(obs[:, tick].to(where), other_h, other_c)
            for left, right in zip(expected, actual, strict=True):
                torch.testing.assert_close(left, right.cpu(), rtol=1e-4, atol=1e-5)
                maximum = max(maximum, float((left - right.cpu()).abs().max().item()))
            cpu_h, cpu_c = expected.hidden, expected.cell
            other_h, other_c = actual.hidden, actual.cell
    exported = export(output / "checkpoint", output / "onnx")
    result = {
        "provenance": "synthetic-diagnostic",
        "acceptance": "unaccepted",
        "device": name,
        "torch": torch.__version__,
        "hidden": HIDDEN,
        "before_nll": before,
        "after_nll": after,
        "training": training,
        "accelerator_cpu_max_abs_error": maximum,
        "onnx_parity": exported["parity"],
        "combat_acceptance_checked": False,
    }
    (output / "verification.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, choices=("cpu", "mps"))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.device, args.output), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
