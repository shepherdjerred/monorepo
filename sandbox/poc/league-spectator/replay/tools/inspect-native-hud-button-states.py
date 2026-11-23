"""Recover original group-button registration and complete state consumers."""
import argparse
import bisect
import hashlib
import json
import struct
from pathlib import Path

import capstone
from macho import MachImage
from native_function_starts import native_function_starts

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
source = MachImage(args.client.read_bytes())
if (hashlib.sha256(image).hexdigest() != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"
        or hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"):
    raise ValueError("Exact original group-button image/function metadata required")
starts = native_function_starts(source.binary)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
regions = {}


def region(target):
    index = bisect.bisect_right(starts, target)
    start, end = starts[index - 1:index + 1]
    if start not in regions:
        regions[start] = {"startRva": start, "endRva": end,
            "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                for op in decoder.disasm(image[start:end], start)]}
    return regions[start]


registrations = []
for name in ["UiElementGroupButtonData", "UiElementGroupButtonState"]:
    value = 0x811C9DC5
    for byte in name.lower().encode():
        value = ((value ^ byte) * 0x1000193) & 0xFFFFFFFF
    sites = []
    for prefix in [b"\xbe", b"\xba", b"\xb9", b"\xbf", b"\x41\xb8"]:
        cursor = 0
        while True:
            cursor = image.find(prefix + struct.pack("<I", value), cursor)
            if cursor < 0:
                break
            owner = region(cursor)
            canonical = next((op for op in owner["instructions"] if op["rva"] == cursor), None)
            if canonical is not None:
                callbacks = []
                for op in owner["instructions"]:
                    if cursor - 128 <= op["rva"] < cursor and op["op"] == "lea" and "[rip " in op["args"]:
                        encoded = bytes.fromhex(op["bytes"])
                        target = op["rva"] + len(encoded) + struct.unpack("<i", encoded[-4:])[0]
                        callbacks.append({"register": op["args"].split(",")[0], "targetRva": target})
                        if 0x9000 <= target < 0x1FEF000:
                            region(target)
                sites.append({"rva": cursor, "ownerRva": owner["startRva"], "callbacks": callbacks})
            cursor += len(prefix) + 4
    registrations.append({"nameHint": name, "hash32": value, "sites": sites})
for target in [0x18BB620, 0x18BCAC0, 0x18BCC50, 0x18BB0C0,
        0x18B9B30, 0x18B9FB0, 0x18A7C00, 0x18B10C0, 0x18AE4C0]:
    region(target)
paths = [Path(__file__), Path(__file__).with_name("native_function_starts.py"), Path(__file__).with_name("macho.py")]
report = {"schema": 1, "kind": "original-hud-group-button-state-source",
    "imageSha256": hashlib.sha256(image).hexdigest(), "registrations": registrations,
    "regions": list(regions.values()),
    "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
    "scope": "Canonical original data registration/constructors and complete selected/state/visibility consumers; runtime owner construction, child binding and execution remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "registrations": registrations,
    "regions": [(hex(row["startRva"]), hex(row["endRva"])) for row in regions.values()]}))
