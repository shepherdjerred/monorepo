"""Construct original authored sliced HUD providers and inspect their ABI.

No nine-slice or three-slice geometry algorithm is invented here.
"""
import argparse
import hashlib
import inspect
import json
from pathlib import Path

import capstone
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
observations = []
for name, factory, registration in [("AtlasData3SliceV", 0x18EF6A0, 0x18A1870), ("AtlasData9Slice", 0x18EF820, 0x18A1960)]:
    row = {"nameHint": name, "factoryRva": factory, "registrationRva": registration, "boundary": None}
    try:
        n.call(factory, {})
        owner = n.u.reg_read(r.UC_X86_REG_RAX)
        size = n.allocations.get(owner)
        if size is None or not 0x20 <= size <= 0x100:
            raise ValueError("Original sliced-provider allocation exceeds its source type bounds")
        table = n.q(owner)
        if not n.base <= table < n.base + len(n.image) - 16 * 8:
            raise ValueError("Original sliced provider lacks a native virtual table")
        methods = []
        for slot in range(16):
            target = n.q(table + slot * 8) - n.base
            if not 0x9000 <= target < 0x1FEF000:
                break
            end = n.image.find(b"\x55\x48\x89\xe5", target + 4, target + 16384)
            if end < 0:
                raise ValueError("Original sliced-provider method lacks a bounded next function")
            methods.append({"slot": slot, "targetRva": target, "endRva": end,
                "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                    for op in decoder.disasm(n.image[target:end], target)]})
        registration_end = n.image.find(b"\x55\x48\x89\xe5", registration + 4, registration + 4096)
        if registration_end < 0:
            raise ValueError("Original sliced-provider field registration is unbounded")
        row.update(ownerBytes=size, defaultsHex=bytes(n.u.mem_read(owner, size)).hex(), vtableRva=table - n.base, methods=methods,
            registrationInstructions=[{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                for op in decoder.disasm(n.image[registration:registration_end], registration)])
    except Exception as error:
        row["boundary"] = {"kind": type(error).__name__, "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(row)
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-hud-sliced-provider-abi-observations", "imageSha256": hashlib.sha256(n.image).hexdigest(),
    "observations": observations, "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Original sliced-provider constructors/defaults, primary virtual methods and authored field registrations; slice geometry, live state and rendered sliced HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "observations": [{"type": row["nameHint"], "ownerBytes": row.get("ownerBytes"), "boundary": row["boundary"],
    "methods": [(item["slot"], hex(item["targetRva"])) for item in row.get("methods", [])]} for row in observations]}))
if any(row["boundary"] for row in observations):
    raise SystemExit(1)
