"""Execute original UI layout math with an explicit supplied viewport boundary."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import math
import capstone
from unicorn import x86_const as registers
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "defaults", "rectangles", "output"]: parser.add_argument(name, type=Path)
parser.add_argument("--roundtrip", action="store_true", help="Also execute original inverse layout against the observed forward output")
args = parser.parse_args()
defaults_bytes, rectangles_bytes = args.defaults.read_bytes(), args.rectangles.read_bytes()
defaults, rectangles = json.loads(defaults_bytes), json.loads(rectangles_bytes)
if rectangles["defaultsSha256"] != hashlib.sha256(defaults_bytes).hexdigest(): raise ValueError("Original rectangle/default source changed")
native = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
native.initialize_layout_constants()
entry = next(item for item in defaults["observations"] if item["classHint"] == "UiPositionRect")
source = next(item for item in rectangles["observations"] if item["originalAnchorDefinition"] and item["originalAnchorDefinition"].get("__type") == "AnchorSingle" and not item["appliedConstructorDefaults"])
position, flags, translation, parent, output = 0x10080000, 0x10090000, 0x100a0000, 0x100a1000, 0x100a2000
native.call(entry["placementConstructorRva"], {registers.UC_X86_REG_RDI: position})
rect = source["authored"]
native.put(position + 0x10, "ffff", *rect["position"], *rect["Size"])
native.put(position + 0x20, "HH", rect["SourceResolutionWidth"], rect["SourceResolutionHeight"])
native.put(native.q(position + 0x28) + 8, "ff", *source["originalAnchorDefinition"]["Anchor"])
# The original UI element factory executes through allocation and all default
# stores, stopping before registration into its unavailable live scene owner.
native.call(0x18abc40, {registers.UC_X86_REG_RDI: 0}, end=0x18abd67)
element = native.u.reg_read(registers.UC_X86_REG_R14)
if native.allocations.get(element) != 0x108: raise ValueError("Original UI element factory allocation changed")
state = element + 0x58
native.call(0x18b0120, {registers.UC_X86_REG_RDI: state, registers.UC_X86_REG_RSI: position, registers.UC_X86_REG_RDX: element + 0x20})
state_defaults = bytes(native.u.mem_read(state, 0x90))
# Recovered original manager default stores and settings factory replace the
# earlier unresolved virtual host model. Its actual native virtual methods run.
# Only the two live canvas dimensions are supplied at their measured data slots.
device = 0x10100000
settings = native.construct_layout_manager(device)
native_scale = struct.unpack("<f", native.u.mem_read(settings + 0xc, 4))[0]
safe_area = list(struct.unpack("<4f", native.u.mem_read(device + 0x128, 16)))
observations = []
for width, height in [[1600, 1200], [1920, 1080], [1280, 720], [800, 600]]:
    native.put(device + 0xe8, "II", width, height)
    native.u.mem_write(state, state_defaults)
    native.put(translation, "ff", 0, 0)
    parent_getter = native.q(native.q(element) + 0x140) - native.base
    native.call(parent_getter, {registers.UC_X86_REG_RDI: element, registers.UC_X86_REG_RSI: 1, registers.UC_X86_REG_RDX: parent})
    original_parent = list(struct.unpack("<4f", native.u.mem_read(parent, 16)))
    native.u.mem_write(output, bytes([0xa5]) * 16)
    try:
        native.call(0x18af630, {registers.UC_X86_REG_RDI: state, registers.UC_X86_REG_RSI: translation,
            registers.UC_X86_REG_RDX: element + 0x20, registers.UC_X86_REG_RCX: parent, registers.UC_X86_REG_R8: output})
    except Exception as error:
        ip = native.u.reg_read(registers.UC_X86_REG_RIP) - native.base
        instruction = next(capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64).disasm(native.image[ip:ip + 16], ip), None)
        failure = {"status": "unresolved-original-dependency", "error": str(error), "rva": ip,
            "instruction": None if instruction is None else instruction.mnemonic + " " + instruction.op_str,
            "registers": {name: native.u.reg_read(getattr(registers, "UC_X86_REG_" + name.upper())) for name in ["rax", "rbx", "rdi", "rsi", "rdx", "rcx", "r12", "r13", "r14", "r15"]},
            "imageSha256": hashlib.sha256(native.image).hexdigest(),
            "scope": "Original dependency failure recorded; no viewport result or guessed replacement supplied"}
        args.output.write_text(json.dumps(failure, indent=2), encoding="utf-8")
        print(json.dumps(failure))
        raise
    observed = {"suppliedViewport": [width, height], "parentGetterRva": parent_getter, "parentRect": original_parent, "originalOutputRect": list(struct.unpack("<4f", native.u.mem_read(output, 16)))}
    if args.roundtrip:
        inverse = output + 0x100
        parent_observed = output + 0x200
        parent_getter = native.q(native.q(element) + 0x140) - native.base
        native.call(parent_getter, {registers.UC_X86_REG_RDI: element, registers.UC_X86_REG_RSI: 1, registers.UC_X86_REG_RDX: parent_observed})
        observed["inverseParentGetterRva"] = parent_getter
        observed["originalInverseParentRect"] = list(struct.unpack("<4f", native.u.mem_read(parent_observed, 16)))
        native.u.mem_write(inverse, bytes([0xa5]) * 16)
        native.call(0x18ae7d0, {registers.UC_X86_REG_RDI: state, registers.UC_X86_REG_RSI: output, registers.UC_X86_REG_RDX: inverse})
        inverse_values = list(struct.unpack("<4f", native.u.mem_read(inverse, 16)))
        observed["originalInverseOutputHex"] = bytes(native.u.mem_read(inverse, 16)).hex()
        observed["inverseStatus"] = "finite-original-result" if all(math.isfinite(value) for value in inverse_values) else "nonfinite-original-result-in-incomplete-runtime-context"
        observed["originalInverseOutputRect"] = inverse_values if all(math.isfinite(value) for value in inverse_values) else None
    observations.append(observed)
report = {"schema": 1, "kind": "original-ui-layout-with-supplied-viewport", "imageSha256": hashlib.sha256(native.image).hexdigest(),
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "nativeHelperSha256": hashlib.sha256((Path(__file__).parent / "ui_manager_native.py").read_bytes()).hexdigest(), "defaultsSha256": hashlib.sha256(defaults_bytes).hexdigest(), "rectanglesSha256": hashlib.sha256(rectangles_bytes).hexdigest(),
    "source": source, "factorySlice": [0x18abc40, 0x18abd67], "layoutRva": 0x18af630, "stateDefaultHex": state_defaults.hex(),
    "nativeScaleDefault": native_scale, "nativeSafeAreaInputs": safe_area, "nativeVirtualMethods": [0x188fcb0, 0x188fd30],
    "originalMathInitialization": {"startRva": 0x14aa3bf, "endRva": 0x14aa5f9,
        "sha256": hashlib.sha256(native.image[0x14aa3bf:0x14aa5f9]).hexdigest(),
        "originalUiDefaultVector": list(struct.unpack("<4f", native.u.mem_read(native.base + 0x256cba0, 16)))},
    "stateDefaultFloatsByOffset": {hex(offset): struct.unpack_from("<f", state_defaults, offset)[0] for offset in [0x60, 0x64, 0x68, 0x6c, 0x70]},
    "observations": observations, "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)],
    "scope": "Original element/manager default stores, data-settings factory, single-anchor initialization, actual viewport virtual methods and forward layout math; only live canvas dimensions supplied. Full native device/scene ownership, saved setting overrides, unknown anchor classes, text and final HUD rendering remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "observations": observations, "originalBlocks": len(native.blocks)}))
