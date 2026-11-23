"""Capture canonical original RIP references to an explicit UI source address."""
import argparse
import bisect
import hashlib
import json
import struct
from pathlib import Path

import capstone
from capstone.x86_const import X86_OP_MEM, X86_REG_RIP
from macho import MachImage
from native_function_starts import native_function_starts

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client"]:
    parser.add_argument(name, type=Path)
parser.add_argument("target", type=lambda value: int(value, 16))
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
source = MachImage(args.client.read_bytes())
image_sha = hashlib.sha256(image).hexdigest()
if (image_sha != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" or
        hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"):
    raise ValueError("Exact original UI source image required")
if not 0 <= args.target < len(image):
    raise ValueError("UI reference target escaped the original image")
starts = native_function_starts(source.binary)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
regions, references = {}, []
for end in range(0x9004, 0x1FEF000):
    if end + struct.unpack_from("<i", image, end - 4)[0] != args.target:
        continue
    for begin in range(max(0x9000, end - 12), end - 4):
        decoded = list(decoder.disasm(image[begin:end], begin))
        if len(decoded) != 1:
            continue
        op = decoded[0]
        if op.address + op.size != end or not any(operand.type == X86_OP_MEM and operand.mem.base == X86_REG_RIP
                and op.address + op.size + operand.mem.disp == args.target for operand in op.operands):
            continue
        index = bisect.bisect_right(starts, begin) - 1
        start, finish = starts[index:index + 2]
        if start not in regions:
            regions[start] = {"startRva": start, "endRva": finish,
                "sha256": hashlib.sha256(image[start:finish]).hexdigest(),
                "instructions": [{"rva": row.address, "bytes": row.bytes.hex(), "op": row.mnemonic, "args": row.op_str}
                                 for row in decoder.disasm(image[start:finish], start)]}
        if any(row["rva"] == begin for row in regions[start]["instructions"]):
            references.append({"rva": begin, "ownerRva": start, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str})
report = {"schema": 1, "kind": "original-canonical-ui-address-references", "imageSha256": image_sha,
          "targetRva": args.target, "references": references, "regions": list(regions.values()),
          "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in [Path(__file__), Path(__file__).with_name("macho.py"),
                                   Path(__file__).with_name("native_function_starts.py")]}}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "references": references, "functions": len(regions)}))
