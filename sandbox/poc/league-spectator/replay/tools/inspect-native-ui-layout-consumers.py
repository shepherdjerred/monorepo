"""Locate original UI consumers calling both anchor endpoint interface slots."""
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
candidates, seen = [], set()
for register in range(8):
    pattern = bytes([0xff, 0x50 + register, 0x30])
    at = 0
    while True:
        at = image.find(pattern, at)
        if at < 0: break
        region = image[max(0, at - 256):at + 256]
        if any(bytes([0xff, 0x50 + other, 0x28]) in region for other in range(8)):
            start = image.rfind(b"\x55\x48\x89\xe5", max(0, at - 2048), at)
            if start >= 0 and start not in seen:
                seen.add(start)
                instructions = []
                for item in decoder.disasm(image[start:min(start + 2048, len(image))], start):
                    instructions.append({"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str})
                    if item.mnemonic == "ret" and item.address > at: break
                candidates.append({"entryRva": start, "endpointCallRva": at, "instructions": instructions})
        at += len(pattern)
report = {"schema": 1, "kind": "native-ui-anchor-endpoint-consumer-candidates", "imageSha256": digest,
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "candidates": candidates,
    "scope": "Exact original indirect-call instruction candidates only; native viewport/anchor algorithm remains unexecuted"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "candidates": [{"entryRva": hex(item["entryRva"]), "endpointCallRva": hex(item["endpointCallRva"])} for item in candidates]}))
