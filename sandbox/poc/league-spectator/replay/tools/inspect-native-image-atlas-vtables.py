"""Inspect exact original atlas image virtual methods and texture-provider references."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
profile = json.loads((args.assets / "decoder-16.21-macos/profile.json").read_bytes())
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7": raise ValueError("Exact native image required")
base = profile["imageBase"]
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
references, at = [], 0
while True:
    at = image.find(struct.pack("<Q", base + 0x18a2340), at)
    if at < 0: break
    references.append(at)
    at += 8
tables = []
for table, slots in [(0x23fa070, 16), *[(address - 5 * 8, 12) for address in references]]:
    methods = []
    for slot in range(slots):
        target = struct.unpack_from("<Q", image, table + slot * 8)[0] - base
        if not 0x9000 <= target < 0x1fef000:
            methods.append({"slot": slot, "rawValue": target + base, "instructions": []})
            continue
        instructions = []
        for op in decoder.disasm(image[target:target + 2048], target):
            instructions.append({"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str})
            if op.mnemonic == "ret": break
        methods.append({"slot": slot, "targetRva": target, "instructions": instructions})
    tables.append({"tableRva": table, "methods": methods})
report = {"schema": 1, "kind": "original-image-atlas-vtable-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "providerLoadPointerLocations": references,
    "tables": tables, "scope": "Exact image constructor vtable and provider method pointer neighborhoods; provider table start remains a candidate until its original constructor is executed"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "tables": len(tables), "providerLoadPointerLocations": [hex(at) for at in references],
    "imageMethods": [{"slot": item["slot"], "entry": hex(item["targetRva"])} for item in tables[0]["methods"] if "targetRva" in item]}))
