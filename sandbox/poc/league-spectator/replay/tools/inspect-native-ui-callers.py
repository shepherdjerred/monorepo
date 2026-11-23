"""Retain canonical original callers for a native UI dependency boundary."""
import argparse
import bisect
import hashlib
import json
import struct
from pathlib import Path

import capstone
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
if (hashlib.sha256(image).hexdigest() != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"
        or hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"):
    raise ValueError("Exact original UI caller image required")
starts = native_function_starts(source.binary)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
regions, callers = {}, []
position = 0x9000
while True:
    position = image.find(b"\xe8", position, 0x1FEF000 - 5)
    if position < 0:
        break
    if position + 5 + struct.unpack_from("<i", image, position + 1)[0] == args.target:
        index = bisect.bisect_right(starts, position) - 1
        begin, end = starts[index:index + 2]
        if begin not in regions:
            regions[begin] = {"startRva": begin, "endRva": end,
                "sha256": hashlib.sha256(image[begin:end]).hexdigest(),
                "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                    for op in decoder.disasm(image[begin:end], begin)]}
        if any(op["rva"] == position and op["op"] == "call" for op in regions[begin]["instructions"]):
            callers.append({"rva": position, "ownerRva": begin})
    position += 1
report = {"schema": 1, "kind": "original-canonical-ui-function-callers", "targetRva": args.target,
    "imageSha256": hashlib.sha256(image).hexdigest(), "callers": callers, "regions": list(regions.values()),
    "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),
        Path(__file__).with_name("macho.py"), Path(__file__).with_name("native_function_starts.py")]}}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "target": hex(args.target), "callers": callers}))
