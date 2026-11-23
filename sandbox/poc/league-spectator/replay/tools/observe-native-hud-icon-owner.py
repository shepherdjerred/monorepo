"""Inspect original icon data factory and its runtime construction interfaces."""
import argparse
import bisect
import hashlib
import inspect
import json
from pathlib import Path

import capstone
from unicorn import x86_const as r
from macho import MachImage
from native_function_starts import native_function_starts
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
source = MachImage(args.client.read_bytes())
if hashlib.sha256(source.binary).hexdigest() != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b":
    raise ValueError("Exact original icon source function metadata required")
starts = native_function_starts(source.binary)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
n.call(0x18F53B0, {})
data = n.u.reg_read(r.UC_X86_REG_RAX)
if n.allocations.get(data) != 0x68:
    raise ValueError("Original icon data factory allocation changed")
table = n.q(data)
methods = []
for slot in range(16):
    target = n.q(table + slot * 8) - n.base
    if not 0x9000 <= target < 0x1FEF000:
        break
    index = bisect.bisect_left(starts, target)
    if index >= len(starts) - 1 or starts[index] != target:
        raise ValueError("Icon data interface does not name an original complete function")
    end = starts[index + 1]
    methods.append({"slot": slot, "targetRva": target, "endRva": end,
        "instructions": [{"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
            for op in decoder.disasm(n.image[target:end], target)]})
sources = {Path(__file__), Path(__file__).with_name("native_function_starts.py"),
    *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-hud-icon-data-owner-interfaces",
    "imageSha256": hashlib.sha256(n.image).hexdigest(), "constructorRva": 0x18F53B0,
    "ownerBytes": n.allocations[data], "defaultsHex": bytes(n.u.mem_read(data, 0x68)).hex(),
    "vtableRva": table - n.base, "methods": methods, "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Complete original icon data construction and exact function metadata for its primary interfaces; runtime owner, controller and resource resolution remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "methods": [(row["slot"], hex(row["targetRva"])) for row in methods]}))
