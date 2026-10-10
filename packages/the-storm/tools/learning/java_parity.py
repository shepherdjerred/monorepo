"""Generate reproducible diagnostic-only Python expectations for the Java CPU actor."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from evaluate import schedule
from export import export
from map_selection.plan import MapBinding
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
    # Independent Python schedule expectations for Java's promotion reader.
    # These identities/counters are codec fixtures, never native acceptance.
    maps = [
        MapBinding(f"map-{index:02d}", f"{index:064x}", f"{index + 300:064x}")
        for index in range(32)
    ]
    (output / "strength.json").write_text(
        json.dumps(
            {
                "schema": 1,
                "kind": "rwf-strength-schedule-codec-fixture",
                "maps": [binding.report() for binding in maps],
                "games": [
                    {
                        **match.map.report(),
                        "opponent": match.opponent,
                        "seed": match.seed,
                        "side": match.side,
                    }
                    for match in schedule(200, 500000000, maps)
                ],
            },
            allow_nan=False,
        )
        + "\n",
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
