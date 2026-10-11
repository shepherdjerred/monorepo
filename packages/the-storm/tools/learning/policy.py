"""Recurrent Trooper actor; inputs contain only the fair observation vector."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import NamedTuple

import torch
from torch import Tensor, nn

RESOURCE = Path(__file__).resolve().parents[2] / (
    "plugin/modules/rwfbots/src/main/resources/rwf-combat-v1.tsv"
)
CONTRACT = "rwf-combat-v1"
HIDDEN = 128
FEATURES = tuple(line.split("\t")[0] for line in RESOURCE.read_text(encoding="utf-8").splitlines())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError("expected a JSON object")
    return value


def array(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("expected a JSON array")
    return value


def integer(value: object, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError("integer outside contract bounds")
    return value


def observation(value: object) -> list[float]:
    values = array(value)
    if len(values) != len(FEATURES):
        raise ValueError("observation shape mismatch")
    result: list[float] = []
    for item in values:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError("observation must contain numbers")
        number = float(item)
        if not math.isfinite(number) or not -1 <= number <= 1:
            raise ValueError("observation must be finite and normalized")
        result.append(number)
    return result


WIRE = mapping(json.loads(RESOURCE.with_name("rwf-duel.json").read_text(encoding="utf-8")))
if WIRE["version"] != 3 or WIRE["contract"] != CONTRACT:
    raise ValueError("unsupported duel wire contract")
HEADS: dict[str, int] = {}
for descriptor in array(WIRE["heads"]):
    head = mapping(descriptor)
    name = head["name"]
    if not isinstance(name, str) or name in HEADS:
        raise ValueError("invalid action head name")
    HEADS[name] = integer(head["size"], 2, 9)
if list(HEADS.items()) != [("move", 9), ("jump", 2), ("sneak", 2), ("sprint", 2), ("attack", 2)]:
    raise ValueError("action heads differ from sword control contract")


class Output(NamedTuple):
    logits: Tensor
    hidden: Tensor
    cell: Tensor


class Policy(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.encoder = nn.Linear(len(FEATURES), HIDDEN)
        self.memory = nn.LSTMCell(HIDDEN, HIDDEN)
        self.head = nn.Linear(HIDDEN, sum(HEADS.values()))

    def initial(self, batch: int, device: torch.device) -> tuple[Tensor, Tensor]:
        return (
            torch.zeros(batch, HIDDEN, device=device),
            torch.zeros(batch, HIDDEN, device=device),
        )

    def forward(self, obs: Tensor, hidden: Tensor, cell: Tensor) -> Output:
        hidden, cell = self.memory(torch.tanh(self.encoder(obs)), (hidden, cell))
        return Output(self.head(hidden), hidden, cell)


def loss(logits: Tensor, actions: Tensor, mask: Tensor) -> Tensor:
    """Sum five categorical losses; padding never contributes to gradients."""
    losses = [
        torch.nn.functional.cross_entropy(
            head.reshape(-1, size), actions[..., index].reshape(-1), reduction="none"
        ).reshape(mask.shape)
        for index, (head, size) in enumerate(
            zip(logits.split(tuple(HEADS.values()), dim=-1), HEADS.values(), strict=True)
        )
    ]
    return (torch.stack(losses).sum(0) * mask).sum() / mask.sum().clamp_min(1)


def device(name: str) -> torch.device:
    if name not in ("cpu", "mps"):
        raise ValueError("device must be cpu or mps")
    if name == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS was requested but is unavailable")
    return torch.device(name)


def write_checkpoint(
    model: Policy, out: Path, metadata: dict[str, object], kind: str = "rwf-trooper-bc"
) -> None:
    if kind not in ("rwf-trooper-bc", "rwf-trooper-ppo"):
        raise ValueError("unknown checkpoint kind")
    out.mkdir(parents=True, exist_ok=False)
    weights = out / "weights.pt"
    torch.save({key: tensor.detach().cpu() for key, tensor in model.state_dict().items()}, weights)
    manifest = {
        "schema": 1,
        "kind": kind,
        "acceptance": "unaccepted",
        "contract": CONTRACT,
        "contract_sha256": digest(RESOURCE),
        "features": list(FEATURES),
        "heads": HEADS,
        "hidden": HIDDEN,
        "tick_hz": 20,
        "weights_sha256": digest(weights),
        "training": metadata,
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


def load_checkpoint(path: Path) -> tuple[Policy, dict[str, object]]:
    manifest = mapping(json.loads((path / "manifest.json").read_text(encoding="utf-8")))
    expected = {
        "schema": 1,
        "acceptance": "unaccepted",
        "contract": CONTRACT,
        "contract_sha256": digest(RESOURCE),
        "features": list(FEATURES),
        "heads": HEADS,
        "hidden": HIDDEN,
        "tick_hz": 20,
    }
    if set(manifest) != {*expected, "kind", "weights_sha256", "training"}:
        raise ValueError("unknown or missing checkpoint fields")
    if any(manifest[key] != value for key, value in expected.items()):
        raise ValueError("checkpoint contract mismatch")
    if manifest["kind"] not in ("rwf-trooper-bc", "rwf-trooper-ppo"):
        raise ValueError("unknown checkpoint kind")
    weights = path / "weights.pt"
    if digest(weights) != manifest["weights_sha256"]:
        raise ValueError("checkpoint digest mismatch")
    raw: object = torch.load(weights, map_location="cpu", weights_only=True)
    state: dict[str, Tensor] = {}
    for key, value in mapping(raw).items():
        if (
            not isinstance(value, Tensor)
            or value.dtype != torch.float32
            or not torch.isfinite(value).all()
        ):
            raise ValueError("invalid checkpoint tensors")
        state[key] = value
    model = Policy()
    model.load_state_dict(state, strict=True)
    return model, manifest
