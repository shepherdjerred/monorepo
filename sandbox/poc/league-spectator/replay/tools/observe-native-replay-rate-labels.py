"""Execute original replay-rate label initialization and argument selection."""
import argparse
import hashlib
import inspect
import json
import struct
from pathlib import Path

from unicorn import x86_const as r
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
sources = {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
# Complete original six-entry static initializer. Stop before destructor
# registration; no initialized table bytes or label text are hand-authored.
n.call(0xF0F47B, {}, end=0xF0F517)
n.call(0xF0CAC0, {})
controller = n.u.reg_read(r.UC_X86_REG_RAX)
if n.allocations.get(controller) != 0x7E8:
    raise ValueError("Original replay-controls owner required")
default = n.u.mem_read(controller + 0x7CD, 1)[0]
labels = []
for index in range(6):
    n.put(controller + 0x7CD, "B", index)
    # Original selection code used immediately before the text widget update.
    # The widget/shaper entry itself is not replaced or reported executed.
    n.call(0xF0660A, {r.UC_X86_REG_RBX: controller}, end=0xF0661F)
    argument = n.u.reg_read(r.UC_X86_REG_RSI)
    if argument != n.base + 0x2509F10 + index * 16:
        raise ValueError("Original replay-rate label selection changed")
    descriptor = bytes(n.u.mem_read(argument, 16))
    pointer, length, capacity = struct.unpack("<QII", descriptor)
    if not n.base <= pointer < n.base + len(n.image) - length - 1 or not 0 < length <= capacity <= 16:
        raise ValueError("Original replay-rate string descriptor escaped source bytes")
    value = bytes(n.u.mem_read(pointer, length))
    if n.u.mem_read(pointer + length, 1) != b"\0":
        raise ValueError("Original replay-rate string lacks its source terminator")
    labels.append({"sourceIndex": index, "text": value.decode("ascii"), "textHex": value.hex(),
        "textRva": pointer - n.base, "length": length, "capacity": capacity,
        "descriptorHex": descriptor.hex(), "labelSha256": hashlib.sha256(value).hexdigest()})
if [row["text"] for row in labels] != [".25X", ".5X", "1X", "2X", "4X", "8X"]:
    raise ValueError("Original replay-rate label control changed")
for path, digest in sources.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
        raise ValueError("Replay-rate label source changed during execution: " + path)
report = {"schema": 1, "kind": "original-replay-rate-label-controls", "imageSha256": hashlib.sha256(n.image).hexdigest(),
    "initializer": {"startRva": 0xF0F47B, "endRva": 0xF0F517},
    "selection": {"startRva": 0xF0660A, "endRva": 0xF0661F}, "sourceDefaultIndex": default,
    "labels": labels, "sources": sources, "originalBlocks": list(n.blocks.values()),
    "scope": "Complete original six-label static initialization and rate-index-to-text-widget argument selection; native font shaping/rendering and cached widget/resource resolution remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "defaultIndex": default, "labels": [row["text"] for row in labels]}))
