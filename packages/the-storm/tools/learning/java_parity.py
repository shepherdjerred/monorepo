"""Generate reproducible diagnostic-only Python expectations for the Java CPU actor."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from export import export
from policy import FEATURES, Policy, digest, load_checkpoint, write_checkpoint


def prepare(output: Path, checkpoint: Path | None = None) -> None:
    output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(1)
    if checkpoint is None:
        torch.manual_seed(23)
        checkpoint = output / "checkpoint"
        write_checkpoint(
            Policy(), checkpoint, {"provenance": "diagnostic-parity", "seed": 23}, "rwf-trooper-ppo"
        )
    model, _ = load_checkpoint(checkpoint)
    model.eval()
    export(checkpoint, output / "onnx")
    rng = np.random.default_rng(43)
    cases: list[dict[str, object]] = []
    with torch.inference_mode():
        for rows in (1, 3, 20, 100):
            hidden, cell = model.initial(rows, torch.device("cpu"))
            steps = []
            for _ in range(16):
                observation = rng.uniform(-1, 1, (rows, len(FEATURES))).astype(np.float32)
                result = model.forward(torch.from_numpy(observation), hidden, cell)
                hidden, cell = result.hidden, result.cell
                steps.append(
                    {
                        "observation": observation.tolist(),
                        "logits": result.logits.tolist(),
                        "hidden": hidden.tolist(),
                        "cell": cell.tolist(),
                    }
                )
            cases.append({"rows": rows, "steps": steps})
    (output / "samples.json").write_text(
        json.dumps(
            {
                "schema": 1,
                "onnx_sha256": digest(output / "onnx/actor.onnx"),
                "rtol": 1e-4,
                "atol": 1e-5,
                "cases": cases,
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
