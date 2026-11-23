"""Retain original direct callers and decoded instructions of IMAA consumers."""
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
digest = hashlib.sha256(image).hexdigest()
if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Exact original image-atlas consumer image required")
targets = {0x17de290, 0x17deba0, 0x17e3760, 0x17e5410, 0x17e5ae0, 0x17e5be0, 0x17e5d30, 0x17ea3a0, 0x17ea560, 0x19175e0}
callers = {target: [] for target in targets}
for position in range(0x9000, 0x1fef000 - 5):
    if image[position] != 0xe8: continue
    target = position + 5 + struct.unpack_from("<i", image, position + 1)[0]
    if target in callers:
        callers[target].append(position)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
functions = {}
for site in {*targets, *[site for sites in callers.values() for site in sites]}:
    start = image.rfind(b"\x55\x48\x89\xe5", max(0x9000, site - 8192), site + 4)
    if start < 0: raise ValueError("Original caller lacks bounded function prefix")
    if start in functions: continue
    next_start = image.find(b"\x55\x48\x89\xe5", max(start + 4, site + 1), site + 8192)
    if next_start < 0: raise ValueError("Original caller lacks bounded next function prefix")
    functions[start] = {"start": start, "end": next_start,
        "instructions": [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str}
                         for item in decoder.disasm(image[start:next_start], start)]}
report = {"schema": 1, "kind": "original-image-atlas-direct-consumer-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "callers": {hex(target): [hex(site) for site in sites] for target, sites in callers.items()},
    "functions": list(functions.values()),
    "scope": "Exact direct-call candidate bytes and original instructions; branches and image lookup semantics require separate execution"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "callers": report["callers"], "functions": len(functions)}))
