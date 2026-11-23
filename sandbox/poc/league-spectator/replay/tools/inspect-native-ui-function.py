"""Capture one canonical original UI function and explicit vtable slots."""
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
parser.add_argument("--vtable", type=lambda value: int(value, 16))
parser.add_argument("--slots", type=int, default=0)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
source = MachImage(args.client.read_bytes())
image_sha = hashlib.sha256(image).hexdigest()
if (image_sha != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" or
        hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"):
    raise ValueError("Exact original UI image required")
starts = native_function_starts(source.binary)
index = bisect.bisect_right(starts, args.target) - 1
begin, end = starts[index:index + 2]
if not begin <= args.target < end:
    raise ValueError("Target has no canonical original function")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
slots = []
if args.vtable is not None:
    if not 0 < args.slots <= 128 or not 0 <= args.vtable <= len(image) - args.slots * 8:
        raise ValueError("Explicit bounded original table required")
    slots = [{"offset": i * 8, "imagePointer": struct.unpack_from("<Q", image, args.vtable + i * 8)[0]}
             for i in range(args.slots)]
report = {"schema": 1, "kind": "original-canonical-ui-function", "imageSha256": image_sha,
          "targetRva": args.target, "startRva": begin, "endRva": end,
          "functionSha256": hashlib.sha256(image[begin:end]).hexdigest(),
          "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                           for op in decoder.disasm(image[begin:end], begin)],
          "vtable": args.vtable, "slots": slots,
          "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in [Path(__file__), Path(__file__).with_name("macho.py"),
                                   Path(__file__).with_name("native_function_starts.py")]}}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "function": [hex(begin), hex(end)], "slots": len(slots)}))
