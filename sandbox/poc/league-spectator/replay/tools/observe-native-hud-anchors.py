"""Execute registered original anchor placement constructors and endpoint methods."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import capstone
from unicorn import x86_const as registers
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "registrations", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
registration_bytes = args.registrations.read_bytes()
registrations = json.loads(registration_bytes)
native = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
native.initialize_layout_constants()
if registrations["imageSha256"] != hashlib.sha256(native.image).hexdigest(): raise ValueError("Original anchor registration image differs")
observations = []
for name, prefix_length in [("AnchorSingle", 16), ("AnchorDouble", 24), ("{f090d2e7}", 28)]:
    field = next(item for item in registrations["fields"] if item["nameHint"] == name)
    ctors = [item for candidate in field["candidates"] for item in candidate["callbackCandidates"] if item["register"] == "r8"]
    if len(ctors) != 1: raise ValueError("Unambiguous original anchor placement constructor required")
    address = 0x10080000
    native.u.mem_write(address, bytes([0xa5]) * 128)
    native.call(ctors[0]["rva"], {registers.UC_X86_REG_RDI: address})
    vtable = native.q(address)
    if not native.base <= vtable < native.base + len(native.image) - 64: raise ValueError("Original anchor vtable required")
    methods = []
    for slot in [5, 6]:
        rva = native.q(vtable + slot * 8) - native.base
        if not 0 <= rva < len(native.image) - 96: raise ValueError("Original anchor endpoint candidate required")
        instructions = []
        for instruction in capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64).disasm(native.image[rva:rva + 96], rva):
            instructions.append({"rva": instruction.address, "bytes": instruction.bytes.hex(), "op": instruction.mnemonic, "args": instruction.op_str})
            if instruction.mnemonic == "ret": break
        native.call(rva, {registers.UC_X86_REG_RDI: address})
        returned = native.u.reg_read(registers.UC_X86_REG_RAX)
        owned_return = address <= returned <= address + prefix_length - 8
        original_return = native.base <= returned <= native.base + len(native.image) - 8
        if not owned_return and not original_return: raise ValueError("Anchor endpoint escaped constructed prefix and original image")
        methods.append({"slot": slot, "rva": rva, "instructions": instructions,
            "returnsInsideConstructedPrefix": owned_return,
            "returnedOffset": returned - address if owned_return else None,
            "returnedOriginalRva": returned - native.base if original_return else None,
            "originalReturnedVector": list(struct.unpack("<2f", native.u.mem_read(returned, 8)))})
    observations.append({"classHash": field["fieldHash"], "nameHint": name, "constructorRva": ctors[0]["rva"],
        "observedPrefixBytes": prefix_length, "objectPrefixHex": bytes(native.u.mem_read(address, prefix_length)).hex(),
        "vtableRva": vtable - native.base, "methods": methods})
report = {"schema": 1, "kind": "original-initialized-hud-anchor-constructor-and-endpoints", "imageSha256": hashlib.sha256(native.image).hexdigest(),
    "registrationSha256": hashlib.sha256(registration_bytes).hexdigest(), "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "nativeHelperSha256": hashlib.sha256((Path(__file__).parent / "ui_manager_native.py").read_bytes()).hexdigest(),
    "originalMathInitialization": {"startRva": 0x14aa3bf, "endRva": 0x14aa5f9, "sha256": hashlib.sha256(native.image[0x14aa3bf:0x14aa5f9]).hexdigest()},
    "observations": observations, "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)],
    "scope": "Registered original placement constructors with initialized constant bank and actual candidate endpoint calls; authored selector overrides and forward viewport consumers are separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "observations": [{"classHash": item["classHash"], "objectPrefixHex": item["objectPrefixHex"], "methods": [{"slot": method["slot"], "returnedOffset": method["returnedOffset"], "vector": method["originalReturnedVector"]} for method in item["methods"]]} for item in observations]}))
