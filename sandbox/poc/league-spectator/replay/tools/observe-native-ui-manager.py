"""Execute the original UI manager factory before live viewport initialization."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from unicorn import x86_const as registers
from ui_manager_native import NativeUiManager

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "output"]: parser.add_argument(name, type=Path)
parser.add_argument("--settings-only", action="store_true", help="Stop after the original UI settings factory returns, before live owner construction")
args = parser.parse_args()
native = NativeUiManager(args.assets / "decoder-16.21-macos", args.client)
manager = 0x10100000
native.u.mem_write(manager, bytes([0xa5]) * 0x1000)
native.call(0x188b540, {registers.UC_X86_REG_RDI: manager}, end=0x188b567 if args.settings_only else None)
if not args.settings_only and native.q(native.base + 0x246d7c0) != manager: raise ValueError("Original factory did not install its UI manager owner")
settings = native.u.reg_read(registers.UC_X86_REG_R14) if args.settings_only else native.q(manager + 0x40)
if native.allocations.get(settings) != 0x180: raise ValueError("Original UI settings allocation changed")
report = {"schema": 1, "kind": "original-ui-manager-factory-defaults", "imageSha256": hashlib.sha256(native.image).hexdigest(),
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "nativeHelperSha256": hashlib.sha256((Path(__file__).parent / "ui_manager_native.py").read_bytes()).hexdigest(), "factoryRva": 0x188b540,
    "managerVtableRva": None if args.settings_only else native.q(manager) - native.base, "managerStorageHex": None if args.settings_only else bytes(native.u.mem_read(manager, 0x1a0)).hex(),
    "settingsHex": bytes(native.u.mem_read(settings, 0x180)).hex(), "nativeScaleDefault": struct.unpack("<f", native.u.mem_read(settings + 0xc, 4))[0],
    "nativeViewportDimensions": None if args.settings_only else list(struct.unpack("<II", native.u.mem_read(manager + 0xe8, 8))),
    "nativeSafeAreaInputs": None if args.settings_only else list(struct.unpack("<4f", native.u.mem_read(manager + 0x128, 16))),
    "factoryStopRva": 0x188b567 if args.settings_only else None,
    "originalBlocks": [native.blocks[key] for key in sorted(native.blocks)], "platformServices": native.services,
    "scope": "Original UI data-settings factory return only" if args.settings_only else "Original UI manager/data-settings factory before live scene/device initialization; no native viewport or saved user setting selection inferred"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "managerVtableRva": report["managerVtableRva"], "nativeScaleDefault": report["nativeScaleDefault"], "nativeViewportDimensions": report["nativeViewportDimensions"], "nativeSafeAreaInputs": report["nativeSafeAreaInputs"], "originalBlocks": len(native.blocks)}))
