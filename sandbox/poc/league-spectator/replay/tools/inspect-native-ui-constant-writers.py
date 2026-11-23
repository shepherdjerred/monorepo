"""Locate exact decoded RIP references to original UI default-vector storage."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7": raise ValueError("Exact original native image required")
targets = {0x256cba0: [], 0x256cb50: []}
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
candidates = set()
for alignment in range(4):
    start, end = 0x1000 + alignment, 0x2000000 + alignment
    for index, (displacement,) in enumerate(struct.iter_unpack("<i", memoryview(image)[start:end])):
        at = start + index * 4
        for extra in [0, 1, 4]:
            target = at + 4 + extra + displacement
            if target in targets: candidates.add((at, target))
for at, target in sorted(candidates):
    start = image.rfind(b"\x55\x48\x89\xe5", max(0, at - 16384), at)
    if start < 0: continue
    instructions, matched = [], False
    for item in decoder.disasm(image[start:at + 128], start):
        references = [item.address + item.size + operand.mem.disp for operand in item.operands
            if operand.type == capstone.CS_OP_MEM and operand.mem.base == capstone.x86_const.X86_REG_RIP]
        if target in references and item.address <= at < item.address + item.size:
            matched = True
        instructions.append({"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str})
    if matched:
        targets[target].append({"entryRva": start, "displacementRva": at, "instructions": instructions})
report = {"schema": 1, "kind": "original-ui-default-vector-reference-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "references": {str(key): value for key, value in targets.items()},
    "scope": "Exact original decoded xrefs to UI factory default-vector storage; static initializer ownership and execution remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "references": {hex(key): [{"entry": hex(item["entryRva"]), "at": hex(item["displacementRva"])} for item in value] for key, value in targets.items()}}))
