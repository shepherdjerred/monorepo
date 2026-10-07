"""Replay a frozen checkpoint against its exact existing CPU ONNX export."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from numpy.typing import NDArray

from policy import (
    FEATURES,
    HIDDEN,
    RESOURCE,
    Policy,
    array,
    digest,
    integer,
    load_checkpoint,
    mapping,
)

CONTRACT = mapping(json.loads(RESOURCE.with_name("rwf-actor-parity.json").read_text("utf-8")))
if CONTRACT != {
    "version": 1,
    "samplesSchema": 2,
    "receiptSchema": 1,
    "kind": "rwf-actor-parity",
    "batches": [1, 3, 20, 100],
    "steps": 16,
    "rtol": 1e-4,
    "atol": 1e-5,
    "samplesFields": [
        "schema",
        "onnx_sha256",
        "actor_manifest_sha256",
        "checkpoint_manifest_sha256",
        "weights_sha256",
        "contract_sha256",
        "rtol",
        "atol",
        "cases",
    ],
}:
    raise ValueError("unsupported actor parity contract")


def validate_export(checkpoint: Path, actor: Path, source: dict[str, object]) -> None:
    manifest = mapping(json.loads((actor / "manifest.json").read_text("utf-8")))
    extension = {
        "onnx_sha256": digest(actor / "actor.onnx"),
        "checkpoint_manifest_sha256": digest(checkpoint / "manifest.json"),
        "opset": 18,
        "inputs": ["observation", "hidden", "cell"],
        "outputs": ["logits", "next_hidden", "next_cell"],
        "parity": manifest.get("parity"),
    }
    if source["kind"] != "rwf-trooper-ppo" or manifest != {**source, **extension}:
        raise ValueError("export does not match the exact unaccepted PPO checkpoint")
    parity = mapping(manifest["parity"])
    error = parity.get("max_abs_error")
    if (
        set(parity) != {"backend", "max_abs_error", "batches", "steps"}
        or parity["backend"] != "onnxruntime-cpu"
        or parity["batches"] != CONTRACT["batches"]
        or parity["steps"] != CONTRACT["steps"]
        or type(error) not in (int, float)
        or not isinstance(error, (int, float))
        or not np.isfinite(error)
        or error < 0
    ):
        raise ValueError("invalid export parity metadata")


def expectations(model: Policy, actor: Path) -> list[dict[str, object]]:
    """Python and ORT carry separate recurrent state, so reset/order bugs fail."""
    onnx.checker.check_model(str(actor / "actor.onnx"), full_check=True)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(actor / "actor.onnx"), options, providers=["CPUExecutionProvider"]
    )
    rng = np.random.default_rng(43)
    cases: list[dict[str, object]] = []
    with torch.inference_mode():
        for rows in (1, 3, 20, 100):
            hidden, cell = model.initial(rows, torch.device("cpu"))
            ort_hidden, ort_cell = hidden.numpy().copy(), cell.numpy().copy()
            steps: list[dict[str, object]] = []
            for _ in range(16):
                observation = rng.uniform(-1, 1, (rows, len(FEATURES))).astype(np.float32)
                result = model.forward(torch.from_numpy(observation), hidden, cell)
                actual = session.run(
                    ["logits", "next_hidden", "next_cell"],
                    {"observation": observation, "hidden": ort_hidden, "cell": ort_cell},
                )
                for left, right in zip(result, actual, strict=True):
                    if (
                        not isinstance(right, np.ndarray)
                        or right.dtype != np.float32
                        or right.shape != tuple(left.shape)
                    ):
                        raise ValueError("ONNX output shape or dtype mismatch")
                    np.testing.assert_allclose(left.numpy(), right, rtol=1e-4, atol=1e-5)
                hidden, cell = result.hidden, result.cell
                ort_hidden, ort_cell = actual[1], actual[2]
                steps.append(
                    {
                        "observation": observation.tolist(),
                        "logits": result.logits.tolist(),
                        "hidden": hidden.tolist(),
                        "cell": cell.tolist(),
                    }
                )
            cases.append({"rows": rows, "steps": steps})
    return cases


def samples(checkpoint: Path, actor: Path) -> dict[str, object]:
    torch.set_num_threads(1)
    files = [
        checkpoint / "weights.pt",
        checkpoint / "manifest.json",
        actor / "actor.onnx",
        actor / "manifest.json",
        RESOURCE,
        RESOURCE.with_name("rwf-actor-parity.json"),
    ]
    frozen = {file: digest(file) for file in files}
    model, source = load_checkpoint(checkpoint)
    validate_export(checkpoint, actor, source)
    model.eval()
    result = {
        "schema": CONTRACT["samplesSchema"],
        "onnx_sha256": frozen[actor / "actor.onnx"],
        "actor_manifest_sha256": frozen[actor / "manifest.json"],
        "checkpoint_manifest_sha256": frozen[checkpoint / "manifest.json"],
        "weights_sha256": frozen[checkpoint / "weights.pt"],
        "contract_sha256": frozen[RESOURCE],
        "rtol": CONTRACT["rtol"],
        "atol": CONTRACT["atol"],
        "cases": expectations(model, actor),
    }
    if any(digest(file) != sha for file, sha in frozen.items()):
        raise ValueError("parity inputs changed during replay")
    return result


def prepare(checkpoint: Path, actor: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=False)
    staged = output / "onnx"
    staged.mkdir()
    for name in ("actor.onnx", "manifest.json"):
        (staged / name).write_bytes((actor / name).read_bytes())
    result = samples(checkpoint, staged)
    # Check the original candidate too, so a source change cannot silently become
    # a successful receipt for a different export snapshot.
    if digest(actor / "actor.onnx") != result["onnx_sha256"] or (
        digest(actor / "manifest.json") != result["actor_manifest_sha256"]
    ):
        raise ValueError("candidate changed while preparing parity")
    (output / "samples.json").write_text(
        json.dumps(result, allow_nan=False) + "\n", encoding="utf-8"
    )


def tensor(value: object, rows: int, columns: int) -> NDArray[np.float32]:
    parsed = array(value)
    if len(parsed) != rows:
        raise ValueError("archived parity batch size mismatch")
    values: list[list[float]] = []
    for raw in parsed:
        row = array(raw)
        if len(row) != columns:
            raise ValueError("archived parity tensor shape mismatch")
        numbers: list[float] = []
        for item in row:
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                raise ValueError("archived parity tensor must contain numbers")
            number = float(item)
            if not math.isfinite(number):
                raise ValueError("archived parity tensor must be finite")
            numbers.append(number)
        values.append(numbers)
    result = np.asarray(values, dtype=np.float32)
    if not np.isfinite(result).all():
        raise ValueError("archived parity tensor is outside float32 range")
    return result


def archived_case(raw: object, expected: object) -> None:
    case, reference = mapping(raw), mapping(expected)
    if set(case) != {"rows", "steps"} or case["rows"] != reference["rows"]:
        raise ValueError("archived parity case differs from fixed batches")
    rows = integer(case["rows"], 1, 100)
    steps, reference_steps = array(case["steps"]), array(reference["steps"])
    if len(steps) != 16:
        raise ValueError("archived parity recurrent steps are incomplete")
    for raw_step, reference_step in zip(steps, reference_steps, strict=True):
        step, target = mapping(raw_step), mapping(reference_step)
        if set(step) != set(target):
            raise ValueError("unknown or missing archived parity tensors")
        for name, columns in (
            ("observation", len(FEATURES)),
            ("logits", 17),
            ("hidden", HIDDEN),
            ("cell", HIDDEN),
        ):
            left, right = tensor(step[name], rows, columns), tensor(target[name], rows, columns)
            if name == "observation":
                np.testing.assert_array_equal(left, right)
            else:
                np.testing.assert_allclose(left, right, rtol=1e-4, atol=1e-5)


def verify(checkpoint: Path, actor: Path, archived: Path) -> dict[str, object]:
    """Recheck the original sample file against actual weights/ORT without rewriting it."""
    before = digest(archived)
    raw = mapping(json.loads(archived.read_text("utf-8")))
    expected = samples(checkpoint, actor)
    if set(raw) != set(expected) or any(
        raw[key] != value for key, value in expected.items() if key != "cases"
    ):
        raise ValueError("archived parity bindings differ from the exact checkpoint and export")
    cases, reference = array(raw["cases"]), array(expected["cases"])
    if len(cases) != len(reference):
        raise ValueError("archived parity batch cases are incomplete")
    for case, target in zip(cases, reference, strict=True):
        archived_case(case, target)
    if digest(archived) != before:
        raise ValueError("archived parity samples changed during verification")
    return {"samples_sha256": before}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--actor", type=Path, required=True)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--output", type=Path)
    action.add_argument("--verify-samples", type=Path)
    args = parser.parse_args()
    if args.verify_samples is not None:
        print(json.dumps(verify(args.checkpoint, args.actor, args.verify_samples)))
    else:
        prepare(args.checkpoint, args.actor, args.output)


if __name__ == "__main__":
    main()
