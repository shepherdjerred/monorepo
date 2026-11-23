"""Rank original UI math functions referencing cached rectangle/anchor fields."""
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
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7": raise ValueError("Exact original native image required")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.skipdata = True
functions, current = [], []
for item in decoder.disasm(image[0x18a0000:0x18d5000], 0x18a0000):
    if item.mnemonic == "push" and item.op_str == "rbp":
        if current: functions.append(current)
        current = []
    current.append({"rva": item.address, "op": item.mnemonic, "args": item.op_str})
if current: functions.append(current)
candidates = []
for instructions in functions:
    fields = {offset for offset in ["0x10", "0x18", "0x50", "0x58", "0x68", "0x70", "0x74", "0x78", "0x7c", "0x80", "0x84", "0x86", "0xa8"] if any(f"+ {offset}]" in item["args"] for item in instructions)}
    math = sum(item["op"] in ["mulps", "divps", "subps", "addps", "mulss", "divss", "subss", "addss"] for item in instructions)
    if math >= 3 and ("0x50" in fields or "0xa8" in fields):
        candidates.append({"entryRva": instructions[0]["rva"], "fieldOffsets": sorted(fields), "mathInstructions": math, "instructions": instructions})
candidates.sort(key=lambda item: (-len(item["fieldOffsets"]), -item["mathInstructions"]))
report = {"schema": 1, "kind": "original-ui-cached-layout-math-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "candidates": candidates,
    "scope": "Original instructions ranked by source-field references only; no viewport formula or class binding inferred"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "candidates": [{"rva": hex(item["entryRva"]), "fields": item["fieldOffsets"], "mathInstructions": item["mathInstructions"]} for item in candidates]}))
