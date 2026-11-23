"""Locate original UI reflection constructors and their actual caller arguments."""
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
for name in ["assets", "client", "definition", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
native = MachImage(args.client.read_bytes())
if (hashlib.sha256(image).hexdigest() != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"
        or hashlib.sha256(native.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"):
    raise ValueError("Exact original reflection image required")
raw = args.definition.read_bytes()
definition = json.loads(raw)
if hashlib.sha256(args.definition.with_suffix(".bin").read_bytes()).hexdigest() != definition["tree"]["sourceSha256"]:
    raise ValueError("Original replay UI definition changed")
classes = set()


def visit(value):
    if isinstance(value, dict):
        if "classHash" in value:
            classes.add(int(value["classHash"], 16))
        for nested in value.values():
            visit(nested)
    elif isinstance(value, list):
        for nested in value:
            visit(nested)


visit(definition["tree"])
starts = native_function_starts(native.binary)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
rows = []
for identity in sorted(classes):
    constructors = []
    offset = 0x9000
    pattern = b"\xbe" + struct.pack("<I", identity)
    while True:
        offset = image.find(pattern, offset, 0x1FEF000)
        if offset < 0:
            break
        index = bisect.bisect_right(starts, offset) - 1
        start, end = starts[index:index + 2]
        ops = list(decoder.disasm(image[start:end], start))
        if any(op.address == offset and op.mnemonic == "mov" and op.op_str.startswith("esi,") for op in ops) and any(
                offset < op.address < offset + 64 and op.mnemonic == "call" and op.op_str == "0x14b5a10" for op in ops):
            callers = []
            for caller in range(0x9007, 0x1FEF000 - 5):
                if image[caller] != 0xE8 or caller + 5 + struct.unpack_from("<i", image, caller + 1)[0] != start:
                    continue
                if image[caller - 7:caller - 4] != b"\x48\x8d\x3d":
                    continue
                owner = starts[bisect.bisect_right(starts, caller) - 1]
                owner_end = starts[bisect.bisect_right(starts, caller)]
                caller_ops = list(decoder.disasm(image[owner:owner_end], owner))
                if not any(op.address == caller - 7 for op in caller_ops) or not any(op.address == caller for op in caller_ops):
                    continue
                descriptor = caller + struct.unpack_from("<i", image, caller - 4)[0]
                if not 0x1FEF000 <= descriptor <= len(image) - 0x88:
                    raise ValueError("Original reflected descriptor escapes static data")
                callers.append({"startRva": caller - 7, "endRva": caller + 5,
                    "descriptorRva": descriptor, "ownerRva": owner, "bytesHex": image[caller - 7:caller + 5].hex()})
            constructors.append({"startRva": start, "endRva": end, "sha256": hashlib.sha256(image[start:end]).hexdigest(),
                "callers": callers})
        offset += 5
    rows.append({"classHash": f"{identity:08x}", "constructors": constructors})
report = {"schema": 1, "kind": "original-replay-ui-type-initializer-source", "imageSha256": hashlib.sha256(image).hexdigest(),
    "definitionSha256": hashlib.sha256(raw).hexdigest(), "classes": rows,
    "sources": {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),
        Path(__file__).with_name("macho.py"), Path(__file__).with_name("native_function_starts.py")]},
    "scope": "Exact canonical metadata constructors and original LEA/CALL descriptor arguments; registration execution and complete native typed BIN fields remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "classes": rows}))
