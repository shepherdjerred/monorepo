"""Generate reproducible diagnostic-only Python expectations for the Java CPU actor."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from export import export
from policy import Policy, write_checkpoint
from promotion.parity import samples


def prepare(output: Path, checkpoint: Path | None = None) -> None:
    output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(1)
    if checkpoint is None:
        torch.manual_seed(23)
        checkpoint = output / "checkpoint"
        write_checkpoint(
            Policy(), checkpoint, {"provenance": "diagnostic-parity", "seed": 23}, "rwf-trooper-ppo"
        )
    export(checkpoint, output / "onnx")
    (output / "samples.json").write_text(
        json.dumps(samples(checkpoint, output / "onnx"), allow_nan=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args()
    prepare(args.output, args.checkpoint)


if __name__ == "__main__":
    main()
