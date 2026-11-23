"""Retain complete original replay-control policy functions, including tail cases.

The first return is not a function boundary: the original five-way button
handler has additional cases after its first return.
"""
import argparse
import hashlib
import json
from pathlib import Path

import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Exact original replay policy image required")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
functions = []
for start in [0xF04C60, 0xF05230, 0xF065B0, 0xF06BC0, 0x18820E0, 0x2D58C0, 0x781500, 0x773D40]:
    if image[start:start + 4] != b"\x55\x48\x89\xe5":
        raise ValueError("Original replay policy entry prefix changed")
    end = image.find(b"\x55\x48\x89\xe5", start + 4, start + 16384)
    if end < 0:
        raise ValueError("Original replay policy lacks a bounded next prefix")
    functions.append({"start": start, "end": end,
        "sha256": hashlib.sha256(image[start:end]).hexdigest(),
        "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
            for op in decoder.disasm(image[start:end], start)]})
report = {"schema": 1, "kind": "original-replay-policy-function-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "functions": functions,
    "scope": "Original complete controller policy and directly called engine-service function candidates; no external service or current UI state is fabricated"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "functions": [{"start": hex(row["start"]), "end": hex(row["end"]), "instructions": len(row["instructions"])} for row in functions]}))
