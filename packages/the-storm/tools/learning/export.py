"""Export a frozen single-step actor and verify recurrent ONNX parity."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

from policy import FEATURES, HIDDEN, digest, load_checkpoint


def export(checkpoint: Path, output: Path) -> dict[str, object]:
    model, manifest = load_checkpoint(checkpoint)
    model.eval()
    output.mkdir(parents=True, exist_ok=False)
    file = output / "actor.onnx"
    example = (torch.zeros(2, len(FEATURES)), torch.zeros(2, HIDDEN), torch.zeros(2, HIDDEN))
    dimension = torch.export.Dim("batch", min=1, max=100)
    torch.onnx.export(
        model,
        example,
        str(file),
        input_names=["observation", "hidden", "cell"],
        output_names=["logits", "next_hidden", "next_cell"],
        opset_version=18,
        dynamo=True,
        external_data=False,
        dynamic_shapes=({0: dimension}, {0: dimension}, {0: dimension}),
    )
    onnx.checker.check_model(str(file), full_check=True)
    session = ort.InferenceSession(str(file), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(23)
    maximum = 0.0
    # Batch sizes differ from the export example. Feed recurrent outputs back in
    # over many steps; one-step parity alone misses state ordering/reset mistakes.
    with torch.no_grad():
        for size in (1, 3, 20, 100):
            hidden = np.zeros((size, HIDDEN), dtype=np.float32)
            cell = np.zeros_like(hidden)
            torch_hidden, torch_cell = (
                torch.from_numpy(hidden.copy()),
                torch.from_numpy(cell.copy()),
            )
            for _ in range(16):
                obs = rng.uniform(-1, 1, (size, len(FEATURES))).astype(np.float32)
                expected = model.forward(torch.from_numpy(obs), torch_hidden, torch_cell)
                actual = session.run(None, {"observation": obs, "hidden": hidden, "cell": cell})
                for left, right in zip(expected, actual, strict=True):
                    if (
                        not isinstance(right, np.ndarray)
                        or right.dtype != np.float32
                        or right.shape != tuple(left.shape)
                    ):
                        raise ValueError("ONNX output shape or dtype mismatch")
                    np.testing.assert_allclose(left.numpy(), right, rtol=1e-4, atol=1e-5)
                    maximum = max(maximum, float(np.max(np.abs(left.numpy() - right))))
                torch_hidden, torch_cell = expected.hidden, expected.cell
                hidden, cell = actual[1], actual[2]
    result = {
        **manifest,
        "onnx_sha256": digest(file),
        "opset": 18,
        "inputs": ["observation", "hidden", "cell"],
        "outputs": ["logits", "next_hidden", "next_cell"],
        "parity": {
            "backend": "onnxruntime-cpu",
            "max_abs_error": maximum,
            "batches": [1, 3, 20, 100],
            "steps": 16,
        },
        "checkpoint_manifest_sha256": digest(checkpoint / "manifest.json"),
    }
    (output / "manifest.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(export(args.checkpoint, args.output), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
