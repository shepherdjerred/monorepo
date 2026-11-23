"""Construct the original reflected replay controller and retain actual vtables.

Construction is separate from loaded scene bindings, event consumption and live
selected-state updates. Unadmitted services fail at their original boundary.
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
for name in ["assets", "client", "candidates", "output"]:
    parser.add_argument(name, type=Path)
args = parser.parse_args()
candidate_bytes = args.candidates.read_bytes()
candidates = json.loads(candidate_bytes)
n = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
n.initialize_layout_constants()
if hashlib.sha256(n.image).hexdigest() != candidates["imageSha256"]:
    raise ValueError("Original controller registration/image lineage changed")
registration = [item for item in candidates["registrations"] if item["nameHint"] == "ReplayControlsViewController"]
if len(registration) != 1:
    raise ValueError("Unique original reflected replay controller registration required")
factory = [item for item in registration[0]["callbacks"] if item["register"] == "rdx"]
if len(factory) != 1 or factory[0]["rva"] != 0xF0CAC0:
    raise ValueError("Original reflected controller factory changed")
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
observation = {"factoryRva": factory[0]["rva"], "boundary": None}
try:
    n.call(factory[0]["rva"], {})
    owner = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.allocations.get(owner) != 0x7E8:
        raise ValueError("Original reflected controller allocation differs")
    tables = []
    for offset in [0, 0x10]:
        pointer = n.q(owner + offset)
        if not n.base <= pointer < n.base + len(n.image) - 8 * 32:
            continue
        methods = []
        for slot in range(32):
            target = n.q(pointer + slot * 8) - n.base
            if not 0x9000 <= target < 0x1FEF000:
                break
            instructions = []
            for op in decoder.disasm(n.image[target:target + 4096], target):
                instructions.append({"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str})
                if op.mnemonic in ["ret", "ud2"]:
                    break
            methods.append({"slot": slot, "targetRva": target, "instructions": instructions})
        tables.append({"ownerOffset": offset, "vtableRva": pointer - n.base, "methods": methods})
    observation.update(ownerBytes=0x7E8, defaultsHex=bytes(n.u.mem_read(owner, 0x7E8)).hex(), tables=tables)
except Exception as error:
    observation["boundary"] = {"kind": type(error).__name__, "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeUiManager.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-replay-control-owner-observation", "imageSha256": hashlib.sha256(n.image).hexdigest(),
    "candidatesSha256": hashlib.sha256(candidate_bytes).hexdigest(), "observation": observation,
    "originalBlocks": list(n.blocks.values()),
    "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(sources)},
    "scope": "Original complete reflected replay controller factory and owned default virtual interfaces; loaded scene, input-event consumption and selected-state updates remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "boundary": observation["boundary"],
    "tables": [{"offset": item["ownerOffset"], "vtableRva": hex(item["vtableRva"]), "methods": len(item["methods"])} for item in observation.get("tables", [])]}))
if observation["boundary"]:
    raise SystemExit(1)
