"""Execute original replay-controller rate-index branches and rate-table load.

The actual reflected controller owns the index. Program fragments stop before
the widget updater and external replay-clock setter; those calls are not faked.
"""
import argparse
import hashlib
import inspect
import json
import struct
from pathlib import Path

import unicorn
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager
from vfx_spawn_native import ADDRESSES

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "owner_proof", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
proof_bytes = args.owner_proof.read_bytes()
proof = json.loads(proof_bytes)
if proof["kind"] != "original-replay-control-owner-observation" or proof["observation"]["boundary"] is not None:
    raise ValueError("Executed original reflected controller ownership required")
for source, digest in proof["sources"].items():
    if hashlib.sha256(Path(source).read_bytes()).hexdigest() != digest:
        raise ValueError("Original reflected controller producer changed")
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
if hashlib.sha256(n.image).hexdigest() != proof["imageSha256"]:
    raise ValueError("Original controller image changed")
n.call(proof["observation"]["factoryRva"], {})
owner = n.u.reg_read(r.UC_X86_REG_RAX)
if n.allocations.get(owner) != 0x7E8:
    raise ValueError("Original replay controller owner differs")
defaults = bytes(n.u.mem_read(owner, 0x7E8))
if defaults != bytes.fromhex(proof["observation"]["defaultsHex"]):
    raise ValueError("Original replay controller constructor/default lineage changed")
original_default = defaults[0x7CD]
stops = {0xF06C88, 0xF06C96}
for at in stops:
    n.u.hook_add(unicorn.UC_HOOK_CODE, lambda uc, address, size, user: uc.emu_stop(), begin=n.base + at, end=n.base + at)


def rate():
    # Original controller's own rate-table load, stopping before its external
    # setter call. Preserve the raw float32 result, not a recomputed JS rate.
    n.call(0xF06C48, {r.UC_X86_REG_RBX: owner}, end=0xF06C5B)
    raw = n.u.reg_read(r.UC_X86_REG_XMM0).to_bytes(16, "little")[:4]
    return {"hex": raw.hex(), "f32": struct.unpack("<f", raw)[0]}


def transition(action):
    before = n.u.mem_read(owner + 0x7CD, 1)[0]
    n.u.context_restore(n.initial)
    n.put(ADDRESSES["stack"], "Q", ADDRESSES["stop"])
    n.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES["stack"])
    n.u.reg_write(r.UC_X86_REG_RBX, owner)
    n.u.emu_start(n.base + (0xF06C66 if action == "increase" else 0xF06C75), ADDRESSES["stop"], count=5000000)
    stopped = n.u.reg_read(r.UC_X86_REG_RIP) - n.base
    if stopped not in stops:
        raise ValueError("Original rate branch escaped its explicit boundary")
    after = n.u.mem_read(owner + 0x7CD, 1)[0]
    return {"action": action, "before": before, "after": after,
        "stopRva": stopped, "widgetUpdateBoundaryReached": stopped == 0xF06C88, "rate": rate()}


default_rate = rate()
controls = []
for index in range(6):
    for action in ["increase", "decrease"]:
        n.u.mem_write(owner, defaults)
        n.put(owner + 0x7CD, "B", index)
        controls.append(transition(action))
n.u.mem_write(owner, defaults)
sequence = [transition(action) for action in ["increase"] * 5 + ["decrease"] * 8 + ["increase"] * 2]
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-replay-rate-index-controls", "imageSha256": hashlib.sha256(n.image).hexdigest(),
    "ownerProofSha256": hashlib.sha256(proof_bytes).hexdigest(), "defaultIndex": original_default, "defaultRate": default_rate,
    "controls": controls, "orderedSequence": sequence, "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Actual original controller index increase/decrease branches, constructor default and original float32 rate-table load; button-event mapping, widget selected-state updater and external replay-clock setter remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "defaultIndex": original_default, "defaultRate": default_rate,
    "controls": controls, "orderedTransitions": len(sequence)}))
