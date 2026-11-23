"""Inspect original selector RNG seed storage and exact direct seed-setter callers."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import capstone
from macho import MachImage

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("client", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7": raise ValueError("Exact original selector RNG image required")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
calls, at = [], 0
while True:
    at = image.find(b"\xe8", at)
    if at < 0 or at + 5 > len(image): break
    if at + 5 + struct.unpack_from("<i", image, at + 1)[0] == 0x14910e0:
        start = image.rfind(b"\x55\x48\x89\xe5", max(0, at - 16384), at)
        if start >= 0:
            instructions = list(decoder.disasm(image[start:at + 256], start))
            if any(item.address == at and item.mnemonic == "call" for item in instructions):
                calls.append({"entryRva": start, "callRva": at,
                    "instructions": [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str} for item in instructions]})
    at += 1
report = {"schema": 1, "kind": "original-animation-selector-rng-seed-source-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "nextFloatRva": 0x1490eb0, "seedSetterRva": 0x14910e0,
    "seedStorageRva": 0x2516698, "originalSeedStorageHex": image[0x2516698:0x25166a0].hex(), "callers": calls,
    "scope": "Exact original seed setter direct callers and cold image storage; host/match seed lineage and global call ordering require execution/source ownership proof"}
report["seedProviderInstructions"] = [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str}
    for item in decoder.disasm(image[0x14db200:0x14db400], 0x14db200)]
native = MachImage(args.client.read_bytes())
if hashlib.sha256(native.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b": raise ValueError("Exact original client slice required")
report["seedProviderImport"] = {"rva": 0x1fee9ea, "name": native.imports[0x1fee9ea]}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "seedStorageHex": report["originalSeedStorageHex"], "callers": [{"entry": hex(item["entryRva"]), "at": hex(item["callRva"])} for item in calls]}))
