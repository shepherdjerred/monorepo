"""Export a fixed jump-in-place actor for native timing checks, without training or human data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from export import export
from policy import HEADS, Policy, write_checkpoint

ACTIONS = {"move": 4, "jump": 1, "sneak": 0, "sprint": 0, "attack": 0}


def idle_policy() -> Policy:
    model = Policy()
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.zero_()
        model.head.bias.fill_(-10)
        offset = 0
        for name, size in HEADS.items():
            model.head.bias[offset + ACTIONS[name]] = 10
            offset += size
    return model.eval()


def generate(output: Path) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(1)
    torch.manual_seed(23)
    metadata: dict[str, object] = {
        "provenance": "diagnostic-native-window",
        "training_run": False,
        "human_demonstrations_used": False,
        "actions": ACTIONS,
    }
    write_checkpoint(idle_policy(), output / "checkpoint", metadata, "rwf-trooper-ppo")
    result = export(output / "checkpoint", output / "onnx")
    receipt = {
        "schema": 1,
        "acceptance": "unaccepted",
        "diagnostic": True,
        **metadata,
        "actor_sha256": result["onnx_sha256"],
        "parity": result["parity"],
    }
    with (output / "diagnostic.json").open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(receipt, indent=2, allow_nan=False) + "\n")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(generate(args.output), allow_nan=False))


if __name__ == "__main__":
    main()
