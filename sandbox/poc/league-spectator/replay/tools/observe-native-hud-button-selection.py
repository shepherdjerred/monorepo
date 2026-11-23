"""Execute complete original group visibility and selected-state consumers.

The original constructors supply data/default sound fields. Hover/press/enable
bytes and child identity bindings are explicit controls, not recovered live
input events, native scene resolution or completed widget resources.
"""
import argparse
import hashlib
import json
import runpy
import struct
import sys
from pathlib import Path

from unicorn import x86_const as r

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "closure", "source", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
base_path = Path(__file__).with_name("observe-native-hud-button-visibility.py")
sources = {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in [Path(__file__), base_path]}
base_output = args.output.with_name(args.output.stem + "-visibility.json")
saved = sys.argv
try:
    sys.argv = [str(base_path), str(args.assets), str(args.client), str(args.closure), str(args.source), str(base_output)]
    state = runpy.run_path(str(base_path))
finally:
    sys.argv = saved
n = state["n"]
prior = state["observations"]
if any(row["boundary"] for row in prior):
    raise ValueError("Complete original authored visibility controls required")
buttons = [pointer for pointer, size in n.allocations.items()
    if size == 0x1D0 and n.q(pointer) == n.base + 0x2401860]
if len(buttons) != len(prior):
    raise ValueError("Original controlled constructor allocation sequence changed")
observations = []
for owner, input_row in zip(buttons, prior):
    row = {"sourceSha256": input_row["sourceSha256"], "objectHash": input_row["objectHash"], "boundary": None}
    try:
        n.call(0x18F3AE0, {})
        data = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(data) != 0x1A0:
            raise ValueError("Original group-button data constructor changed")
        n.call(0x18B9C30, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: data})
        # Only source-listed state references are inspected. The earlier control
        # records the actual pre-resolved child pointers in the native vectors.
        children = {}
        for slot in range(8):
            address = owner + 0x98 + slot * 0x20
            listing, count = n.q(address), struct.unpack("<I", n.u.mem_read(address + 8, 4))[0]
            for index in range(count):
                child = n.q(listing + index * 8)
                children[state["owners"][child]] = child
            text = n.q(address + 0x10)
            if text:
                children[state["owners"][text]] = text
        visible_method = n.q(n.q(owner) + 0x98) - n.base
        cases = []
        for enabled in [0, 1]:
            for pressed in [0, 1]:
                for hovered in [0, 1]:
                    for other in [0, 1]:
                        for selected in [0, 1]:
                            # Reset through original visibility interfaces;
                            # state bytes below are declared control inputs.
                            n.call(visible_method, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: 0})
                            for child in children.values():
                                n.call(0x18B10C0, {r.UC_X86_REG_RDI: child, r.UC_X86_REG_RSI: 0})
                            for offset, value in [(0x1C1, pressed), (0x1C3, enabled), (0x1C4, hovered), (0x1C5, other)]:
                                n.put(owner + offset, "B", value)
                            # Establish the opposite selection first, so the
                            # source setter must execute its changed-state path.
                            n.put(owner + 0x1C6, "B", 1 - selected)
                            n.call(visible_method, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: 1})
                            n.call(0x18BB620, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: selected})
                            n.call(0x18BB0C0, {r.UC_X86_REG_RDI: owner})
                            if n.u.reg_read(r.UC_X86_REG_RAX) != selected:
                                raise ValueError("Original selected getter differs from its completed setter")
                            slot = n.u.mem_read(owner + 0x1C0, 1)[0]
                            if slot not in range(8):
                                raise ValueError("Original selected-state consumer escaped its eight source slots")
                            source = input_row["states"][slot]
                            expected = [] if source is None else sorted(set([*source["display"],
                                *([] if source["text"] is None else [source["text"]])]))
                            actual = sorted(key for key, child in children.items()
                                if struct.unpack("<I", n.u.mem_read(child + 0x20, 4))[0] & 1)
                            if actual != expected:
                                raise ValueError("Complete original selected/visible consumers changed source child membership")
                            cases.append({"controlledBytes": {"1c1": pressed, "1c3": enabled, "1c4": hovered,
                                "1c5": other, "1c6": selected}, "sourceStateSlot": slot, "visibleChildren": actual})
        row.update(visibilityMethodRva=visible_method, cases=cases)
    except Exception as error:
        row["boundary"] = {"kind": type(error).__name__, "message": str(error),
            "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(row)
    if row["boundary"]:
        break
for path, digest in sources.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
        raise ValueError("Original selected-state observer changed during execution")
report = {"schema": 1, "kind": "original-authored-button-selected-state-controls",
    "imageSha256": hashlib.sha256(n.image).hexdigest(), "sources": sources,
    "visibilityReceipt": str(base_output), "visibilityReceiptSha256": hashlib.sha256(base_output.read_bytes()).hexdigest(),
    "observations": observations, "originalBlocks": list(n.blocks.values()),
    "scope": "Complete original group data/runtime constructors, visibility setter, selected setter/getter and child visibility transitions; source lists are pre-resolved icon interface controls, default sound fields remain original, input flag bytes are explicit; native scene resolution, live input scheduling, full child resource types and rendered widget parity remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
failures = [row for row in observations if row["boundary"]]
print(json.dumps({"output": str(args.output), "buttons": len(observations),
    "controls": sum(len(row.get("cases", [])) for row in observations), "failures": failures}))
if failures:
    raise SystemExit(1)
