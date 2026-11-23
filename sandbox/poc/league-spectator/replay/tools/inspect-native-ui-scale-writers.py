"""Locate original UI cached-transform stores without assigning field semantics."""
import argparse
import hashlib
import json
from pathlib import Path
import re
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
for instruction in decoder.disasm(image[0x1880000:0x18d5000], 0x1880000):
    if instruction.mnemonic == "push" and instruction.op_str == "rbp":
        if current: functions.append(current)
        current = []
    current.append({"rva": instruction.address, "bytes": instruction.bytes.hex(), "op": instruction.mnemonic, "args": instruction.op_str})
if current: functions.append(current)
candidates = []
for instructions in functions:
    stores = [item for item in instructions if item["op"].startswith("mov") and re.search(r"\[[^]]+ \+ 0x(?:60|64|68|6c|b8|bc|c0|c4)\],", item["args"])]
    if stores: candidates.append({"entryRva": instructions[0]["rva"], "stores": stores, "instructions": instructions})
report = {"schema": 1, "kind": "native-ui-cached-transform-store-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "candidates": candidates,
    "scope": "Exact original UI-region store instructions only; registration, ownership and scale/controller semantics remain unproven"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "candidates": [{"entry": hex(item["entryRva"]), "stores": [{"rva": hex(store["rva"]), "op": store["op"], "args": store["args"]} for store in item["stores"]]} for item in candidates]}))
