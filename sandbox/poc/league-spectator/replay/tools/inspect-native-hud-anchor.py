"""Inspect the original allocated UiPositionRect anchor's native interface."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import capstone
from unicorn import x86_const as registers
from vfx_spawn_native import NativeSpawn

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "defaults", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
defaults_bytes = args.defaults.read_bytes()
defaults = json.loads(defaults_bytes)
native = NativeSpawn(args.assets / "decoder-16.21-macos", args.client)
if defaults["imageSha256"] != hashlib.sha256(native.image).hexdigest(): raise ValueError("Original HUD image differs")
ctor = next(item for item in defaults["observations"] if item["classHint"] == "UiPositionRect")["placementConstructorRva"]
address = 0x10080000
native.call(ctor, {registers.UC_X86_REG_RDI: address})
anchor = native.q(address + 0x28)
size = native.allocations.get(anchor)
if not size: raise ValueError("Native allocated anchor required")
vtable = native.q(anchor)
if not native.base <= vtable < native.base + len(native.image) - 80: raise ValueError("Original anchor vtable required")
methods = []
for slot, pointer in enumerate(struct.unpack("<10Q", native.u.mem_read(vtable, 80))):
    if not native.base <= pointer < native.base + len(native.image) - 384: continue
    rva = pointer - native.base
    instructions = []
    for item in capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64).disasm(native.image[rva:rva + 384], rva):
        instructions.append({"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str})
        if item.mnemonic == "ret": break
    methods.append({"slotCandidate": slot, "rva": rva, "instructions": instructions})
report = {"schema": 1, "kind": "original-ui-default-anchor-interface-candidates", "imageSha256": defaults["imageSha256"],
    "defaultsSha256": hashlib.sha256(defaults_bytes).hexdigest(), "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "allocatedObjectBytes": size, "objectHex": bytes(native.u.mem_read(anchor, size)).hex(), "vtableRva": vtable - native.base, "methods": methods,
    "scope": "Original constructor-owned anchor interface candidates only; method semantics and viewport layout not inferred from slot adjacency"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "allocatedObjectBytes": size, "methods": [{"slot": item["slotCandidate"], "rva": hex(item["rva"])} for item in methods]}))
