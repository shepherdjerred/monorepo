"""Execute original registered placement constructors for HUD data defaults."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import capstone
from unicorn import x86_const as registers
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("client", type=Path)
parser.add_argument("registrations", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
registration_bytes = args.registrations.read_bytes()
registrations = json.loads(registration_bytes)
native = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
native.initialize_layout_constants()
if registrations["imageSha256"] != hashlib.sha256(native.image).hexdigest():
    raise ValueError("HUD registrations differ from original image")
results = []
for name, size in [("UiElementRect", 0x20), ("UiPositionRect", 0x48), ("GameFontDescription", 0x78)]:
    field = next(item for item in registrations["fields"] if item["nameHint"] == name)
    callbacks = [callback for item in field["candidates"] for callback in item["callbackCandidates"] if callback["register"] == "r8"]
    if len(callbacks) != 1: raise ValueError("Ambiguous original HUD placement constructor")
    callback = callbacks[0]
    address = 0x10080000
    native.u.mem_write(address, bytes([0xa5]) * 0x1000)
    native.call(callback["rva"], {registers.UC_X86_REG_RDI: address})
    raw = bytes(native.u.mem_read(address, size))
    result = {"classHint": name, "placementConstructorRva": callback["rva"], "objectHex": raw.hex()}
    vtable = struct.unpack_from("<Q", raw)[0]
    if not native.base <= vtable < native.base + len(native.image) - 64:
        raise ValueError("Native HUD class vtable escaped the original image")
    result["vtableRva"] = vtable - native.base
    methods = []
    for slot, pointer in enumerate(struct.unpack("<8Q", native.u.mem_read(vtable, 64))):
        if not native.base <= pointer < native.base + len(native.image) - 128: continue
        rva = pointer - native.base
        instructions = []
        for item in capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64).disasm(native.image[rva:rva + 256], rva):
            instructions.append({"rva": item.address, "op": item.mnemonic, "args": item.op_str})
            if item.mnemonic == "ret": break
        methods.append({"slot": slot, "rva": rva, "instructions": instructions})
    result["vtableCandidates"] = methods
    if name == "UiElementRect":
        result["registeredFields"] = {"position": list(struct.unpack_from("<ff", raw, 8)), "size": list(struct.unpack_from("<ff", raw, 0x10)),
            "sourceResolutionWidth": struct.unpack_from("<H", raw, 0x18)[0], "sourceResolutionHeight": struct.unpack_from("<H", raw, 0x1a)[0]}
    if name == "UiPositionRect":
        result["registeredFlags"] = {"ignoreGlobalScale": raw[0x30], "disablePixelSnappingX": raw[0x31],
            "disablePixelSnappingY": raw[0x32], "disableResolutionDownscale": raw[0x33]}
        anchor = struct.unpack_from("<Q", raw, 0x28)[0]
        result["anchorPointerPresent"] = bool(anchor)
        if anchor:
            anchor_size = native.allocations.get(anchor)
            if not anchor_size: raise ValueError("Original HUD anchor allocation is unowned")
            result["anchorAllocationBytes"] = anchor_size
            result["anchorObjectHex"] = bytes(native.u.mem_read(anchor, anchor_size)).hex()
    results.append(result)
report = {"schema": 1, "kind": "original-hud-data-constructor-observations", "build": "16.21.829.8620",
    "imageSha256": hashlib.sha256(native.image).hexdigest(), "registrationSha256": hashlib.sha256(registration_bytes).hexdigest(),
    "clientSha256": hashlib.sha256(args.client.read_bytes()).hexdigest(), "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "observations": results, "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)],
    "originalMathInitialization": {"startRva": 0x14aa3bf, "endRva": 0x14aa5f9,
        "sha256": hashlib.sha256(native.image[0x14aa3bf:0x14aa5f9]).hexdigest()},
    "scope": "Original registered data placement constructors only; authored UI BIN overrides, viewport/anchor scaling and rendered native HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "observations": [{"classHint": item["classHint"], "placementConstructorRva": item["placementConstructorRva"],
    **({"registeredFields": item["registeredFields"]} if "registeredFields" in item else {}),
    **({"registeredFlags": item["registeredFlags"]} if "registeredFlags" in item else {})} for item in results]}))
