"""Locate original stores initializing the global UI viewport-manager owner."""
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
target = 0x246d7c0
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
stores = []
for opcode in range(5, 64, 8):
    pattern, at = bytes([0x48, 0x89, opcode]), 0
    while True:
        at = image.find(pattern, at)
        if at < 0 or at + 7 > len(image): break
        if at + 7 + struct.unpack_from("<i", image, at + 3)[0] == target:
            start = image.rfind(b"\x55\x48\x89\xe5", max(0, at - 4096), at)
            if start >= 0:
                instructions = list(decoder.disasm(image[start:start + 4096], start))
                if any(item.address == at and item.mnemonic == "mov" for item in instructions):
                    stores.append({"entryRva": start, "storeRva": at, "instructions": [{"rva": item.address, "op": item.mnemonic, "args": item.op_str} for item in instructions]})
        at += 1
profile = json.loads((args.assets / "decoder-16.21-macos/profile.json").read_bytes())
vtable = 0x188b2d0 + 7 + 0xb74941
methods = []
for slot, pointer in enumerate(struct.unpack_from("<10Q", image, vtable)):
    rva = pointer - profile["imageBase"]
    if not 0 <= rva < len(image) - 512: continue
    instructions = []
    for item in decoder.disasm(image[rva:rva + 512], rva):
        instructions.append({"rva": item.address, "op": item.mnemonic, "args": item.op_str})
        if item.mnemonic == "ret": break
    methods.append({"slot": slot, "rva": rva, "instructions": instructions})
report = {"schema": 1, "kind": "original-ui-viewport-owner-initialization-stores", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "globalPointerRva": target, "stores": stores, "vtableRva": vtable, "methodCandidates": methods,
    "scope": "Exact original RIP-relative stores and factory contexts only; manager constructor and live viewport selection not yet executed"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "stores": [{"entry": hex(item["entryRva"]), "store": hex(item["storeRva"])} for item in stores]}))
