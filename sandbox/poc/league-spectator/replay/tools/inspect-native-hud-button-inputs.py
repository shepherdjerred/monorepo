"""Inventory original group-button input-byte writers without guessing events."""
import argparse
import hashlib
import json
from pathlib import Path

import capstone
from capstone import x86_const
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
    raise ValueError("Exact original input-consumer image required")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
starts = native_function_starts(source.binary)
regions = []
for start, end in zip(starts, starts[1:]):
    if not 0x18B9B30 <= start < 0x18BCD30:
        continue
    instructions = list(decoder.disasm(image[start:end], start))
    references = [op.address for op in instructions for operand in op.operands
        if operand.type == x86_const.X86_OP_MEM
        and operand.mem.disp in [0x141, 0x144, 0x145, 0x149, 0x14C, 0x14D, 0x1C1, 0x1C2, 0x1C3, 0x1C4, 0x1C5, 0x1C6]]
    writes = [op.address for op in instructions for operand in op.operands
        if operand.type == x86_const.X86_OP_MEM and operand.access & capstone.CS_AC_WRITE
        and operand.mem.disp in [0x141, 0x144, 0x145, 0x149, 0x14C, 0x14D, 0x1C1, 0x1C2, 0x1C3, 0x1C4, 0x1C5, 0x1C6]]
    if references or 0x18BB6E0 <= start < 0x18BC550:
        regions.append({"startRva": start, "endRva": end, "candidateWrites": writes,
            "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic,
                "args": op.op_str} for op in instructions]})
report = {"schema": 1, "kind": "original-group-button-input-writers",
    "imageSha256": hashlib.sha256(image).hexdigest(), "regions": regions,
    "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in [Path(__file__), Path(__file__).with_name("macho.py"),
            Path(__file__).with_name("native_function_starts.py")]},
    "scope": "Complete original functions with candidate flag writes; event names, ownership and caller bindings require separate original controls"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "regions": [{"start": hex(row["startRva"]),
    "writes": [hex(value) for value in row["candidateWrites"]]} for row in regions]}))
