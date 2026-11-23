"""Execute original HUD image-provider constructors and inspect their actual virtual tables."""
import argparse
import hashlib
import inspect
import json
from pathlib import Path
import capstone
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
observations = []
for name, constructor, interface_offset, expected_bytes in [("AtlasData", 0x18ef3a0, 0x20, 0x38), ("LooseUiTextureData", 0x18ef9f0, 0x18, 0x20)]:
    observation = {"nameHint": name, "constructorRva": constructor, "boundary": None}
    try:
        n.call(constructor, {})
        owner = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(owner) != expected_bytes: raise ValueError("Original image-provider allocation changed")
        tables = []
        for offset in [0, interface_offset]:
            at = n.q(owner + offset)
            if not n.base <= at < n.base + len(n.image) - 8 * 6: raise ValueError("Original image provider lacks an original virtual table")
            methods = []
            for slot in range(6):
                target = n.q(at + slot * 8) - n.base
                instructions = []
                if 0x9000 <= target < 0x1fef000:
                    for op in decoder.disasm(n.image[target:target + 2048], target):
                        instructions.append({"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str})
                        if op.mnemonic in ["ret", "ud2"]: break
                methods.append({"slot": slot, "targetRva": target, "instructions": instructions})
            tables.append({"interfaceOffset": offset, "tableRva": at - n.base, "methods": methods})
        observation.update(ownerBytes=expected_bytes, defaultsHex=bytes(n.u.mem_read(owner, expected_bytes)).hex(), tables=tables)
    except Exception as error:
        observation["boundary"] = {"kind": type(error).__name__, "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    observations.append(observation)
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-ui-image-provider-constructor-observations", "imageSha256": hashlib.sha256(n.image).hexdigest(),
    "observations": observations, "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Executed original data constructors and actual interface pointers/default bytes; virtual provider sampling and rendered HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "providers": [{"name": row["nameHint"], "boundary": row["boundary"],
    "tables": [{"offset": table["interfaceOffset"], "rva": hex(table["tableRva"]), "methods": [hex(method["targetRva"]) for method in table["methods"]]} for table in row.get("tables", [])]} for row in observations]}))
if any(row["boundary"] for row in observations): raise SystemExit(1)
