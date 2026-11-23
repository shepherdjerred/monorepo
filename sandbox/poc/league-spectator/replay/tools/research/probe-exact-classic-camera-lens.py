"""Execute the archived 16.23 CameraConfig and gameplay projection fragments."""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import unicorn
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    private_cache = (Path.cwd() / ".cache").resolve()
    if not args.output.parent.resolve().is_relative_to(private_cache) or args.output.exists():
        raise ValueError("Expected a fresh private .cache output")

    binary = args.executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    if digest != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15":
        raise ValueError("Expected the exact archived 16.23 Mach-O")
    image = MachImage(binary)
    imports = {0x2051394: "_tanf", 0x2050B90: "___sincosf_stret"}
    if any(image.imports.get(entry) != name for entry, name in imports.items()):
        raise ValueError("Expected the exact native camera math imports")

    cpu = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    cpu.mem_map(image.base, len(image.image))
    cpu.mem_write(image.base, bytes(image.image))
    arena = 0x10000000
    cpu.mem_map(arena, 0x10000)
    config, camera, lens, stack = (arena + offset for offset in (0x1000, 0x2000, 0x3000, 0xE000))

    def write(at, fmt, *values):
        cpu.mem_write(at, struct.pack("<" + fmt, *values))

    def read(at, fmt):
        return struct.unpack("<" + fmt, cpu.mem_read(at, struct.calcsize("<" + fmt)))

    def run(entry, end, registers, *, returning=False):
        cpu.reg_write(r.UC_X86_REG_RSP, stack + 8 if returning else stack)
        if returning:
            write(stack + 8, "Q", arena)
        for register, value in registers:
            cpu.reg_write(register, value)
        stop = image.base + end if end is not None else arena
        cpu.emu_start(image.base + entry, stop, count=256)
        if cpu.reg_read(r.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Unexpected native stop for {entry:#x}")

    tangent_inputs = []

    def read_xmm0_float(engine):
        bits = engine.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF
        return struct.unpack("<f", struct.pack("<I", bits))[0]

    def return_xmm0(engine, result):
        stack_pointer = engine.reg_read(r.UC_X86_REG_RSP)
        engine.reg_write(r.UC_X86_REG_XMM0, result)
        engine.reg_write(r.UC_X86_REG_RSP, stack_pointer + 8)
        engine.reg_write(r.UC_X86_REG_RIP, read(stack_pointer, "Q")[0])

    def tangent_import(engine, _address, _size, _user):
        value = read_xmm0_float(engine)
        tangent_inputs.append(value)
        (result,) = struct.unpack("<I", struct.pack("<f", math.tan(value)))
        return_xmm0(engine, result)

    def sincos_import(engine, _address, _size, _user):
        value = read_xmm0_float(engine)
        (result,) = struct.unpack("<Q", struct.pack("<2f", math.sin(value), math.cos(value)))
        return_xmm0(engine, result)

    for entry, handler in ((0x2051394, tangent_import), (0x2050B90, sincos_import)):
        address = image.base + entry
        cpu.hook_add(unicorn.UC_HOOK_CODE, handler, begin=address, end=address)
    run(0x22F890, None, [(r.UC_X86_REG_RDI, config)], returning=True)
    (default_fov,) = read(config + 0x34, "f")
    if default_fov != 40:
        raise ValueError("Current CameraConfig vertical FOV default changed")

    frame = stack + 0x200
    run(0xC8B400, None, [(r.UC_X86_REG_RDI, camera + 0x240)], returning=True)
    (pitch,) = read(camera + 0x25C, "f")
    (yaw,) = read(camera + 0x268, "f")
    (yaw_reference,) = read(camera + 0x29C, "f")
    if (pitch, yaw, yaw_reference) != (56, 180, 180):
        raise ValueError("Original default gameplay angles changed")
    run(0xC5CF48, 0xC5CF84, [(r.UC_X86_REG_RAX, config), (r.UC_X86_REG_R14, camera)])
    run(0xC5CFE9, 0xC5D046, [(r.UC_X86_REG_R14, camera), (r.UC_X86_REG_RBP, frame)])
    write(camera + 0x470, "Q", config)
    run(0xC5E2C0, None, [(r.UC_X86_REG_RDI, camera), (r.UC_X86_REG_RSI, 0)], returning=True)
    magnitude = read_xmm0_float(cpu)
    # The normal camera passes flag 1. A nonzero mode gate bypasses the
    # telemetry-only branch while still executing its scalar computation.
    mode_gate = arena + 0x4000
    write(mode_gate + 8, "I", 1)
    write(image.base + 0x24E85B0, "Q", mode_gate)
    run(0xC5E2C0, None, [(r.UC_X86_REG_RDI, camera), (r.UC_X86_REG_RSI, 1)], returning=True)
    if read_xmm0_float(cpu) != magnitude:
        raise ValueError("Flagged camera offset calculation changed the default magnitude")
    write(frame - 0x70, "4f", magnitude, 0, 0, 0)
    write(frame - 0x40, "8f", *([0] * 8))
    run(0xC5D5E9, 0xC5D70C, [(r.UC_X86_REG_RBX, camera), (r.UC_X86_REG_RBP, frame)])
    eye_offset = read(frame - 0x30, "3f")
    offset_bits = struct.pack("<3f", *eye_offset).hex()
    magnitude_bits = struct.pack("<f", magnitude).hex()
    if magnitude_bits != "b0211045" or offset_bits != "0000000023fbee44d931a1c4":
        raise ValueError(f"Original default eye offset changed: {magnitude_bits}/{offset_bits}")
    (configured_distance,) = read(camera + 0x3C0, "f")
    pose = {
        "pitchDegrees": pitch,
        "yawDegrees": yaw,
        "yawReferenceDegrees": yaw_reference,
        "nativeConfiguredDistance": configured_distance,
        "nativeFovDistanceFactor": read(camera + 0x3B8, "f")[0],
        "nativeEyeOffsetMagnitude": magnitude,
        "nativeEyeOffsetMagnitudeF32LE": magnitude_bits,
        "nativeEyeOffsetXYZ": eye_offset,
        "nativeEyeOffsetXYZF32LE": offset_bits,
        "flaggedMagnitudeMatchesUnderSuppliedModeGate": True,
        "scope": (
            "Generic gameplay defaults at supplied zero focus. Yaw equals its reference, "
            "so no additional X/Z rotation applies. Actor-follow policy, interpolation, "
            "recentering and live overrides are outside this control."
        ),
    }

    setting_provider, setting_vtable, get_setting = (arena + offset for offset in (0x5000, 0x6000, 0x7000))
    write(image.base + 0x25DB0A0, "Q", setting_provider)
    write(setting_provider, "Q", setting_vtable)
    write(setting_vtable + 0x20, "Q", get_setting)
    write(get_setting, "B", 0xC3)
    setting_calls = []
    setting_override = None

    def get_float_setting(engine, _address, _size, _user):
        if engine.reg_read(r.UC_X86_REG_RDI) != setting_provider:
            raise ValueError("Unexpected original camera setting provider")
        setting_calls.append((engine.reg_read(r.UC_X86_REG_ESI), read_xmm0_float(engine)))
        if setting_override is not None:
            result = struct.unpack("<I", struct.pack("<f", setting_override))[0]
            return_xmm0(engine, result)

    cpu.hook_add(unicorn.UC_HOOK_CODE, get_float_setting, begin=get_setting, end=get_setting)

    def produce_far(distance, override):
        nonlocal setting_override
        setting_calls.clear()
        setting_override = override
        write(camera + 0x3C0, "f", distance)
        run(0xC5D33A, 0xC5D376, [(r.UC_X86_REG_RBX, camera)])
        if setting_calls != [(0x16, 10000)]:
            raise ValueError("Original default camera far setting or its key changed")
        (far,) = read(camera + 0x298, "f")
        expected = (10000 if override is None else override) + distance
        if far != expected:
            raise ValueError(f"Original far plane differs from {expected}: {far}")
        return {"configuredDistance": distance, "suppliedOverride": override, "farClip": far}

    far_cases = [
        produce_far(configured_distance, None),
        produce_far(configured_distance / 2, None),
        produce_far(configured_distance, 20000),
    ]
    write(camera + 0x3C0, "f", configured_distance)

    def project(fov, aspect, supplied_far):
        write(config + 0x34, "f", fov)
        run(0xC5CF76, 0xC5CF84, [(r.UC_X86_REG_RAX, config), (r.UC_X86_REG_R14, camera)])
        run(0xC5CFE9, 0xC5D046, [(r.UC_X86_REG_R14, camera), (r.UC_X86_REG_RBP, frame)])
        write(camera + 0x298, "f", supplied_far)
        run(0xC5D7F1, 0xC5D804, [(r.UC_X86_REG_RBX, camera), (r.UC_X86_REG_R14, lens)])
        run(0xC5D82B, 0xC5D847, [(r.UC_X86_REG_RBX, camera), (r.UC_X86_REG_R14, lens)])
        write(lens + 0x14, "f", aspect)
        near, far, used_aspect = read(lens + 0xC, "3f")
        if read(lens + 0x54, "fB") != (fov, 0) or near != 50 or far != supplied_far:
            raise ValueError("Original gameplay projection lens fields did not propagate")
        tangent_inputs.clear()
        projection = lens + 0x224
        run(0x184335B, 0x18433A7, [(r.UC_X86_REG_RBX, lens), (r.UC_X86_REG_R15, projection)])
        matrix = read(projection, "16f")
        reference = 1 / math.tan(math.radians(fov) / 2)
        if (
            len(tangent_inputs) != 1
            or not math.isclose(tangent_inputs[0], math.radians(fov) / 2, rel_tol=1e-7)
            or not math.isclose(matrix[0], reference / used_aspect, rel_tol=1e-7)
            or not math.isclose(matrix[5], reference, rel_tol=1e-7)
            or matrix[11] != 1
            or not math.isclose(matrix[10], far / (far - near), rel_tol=1e-7)
            or not math.isclose(matrix[14], -near * far / (far - near), rel_tol=1e-7)
        ):
            raise ValueError("Native perspective matrix disagrees with reference axes or clipping")
        return {
            "verticalFovDegrees": fov,
            "suppliedAspect": used_aspect,
            "nativeNear": near,
            "suppliedFar": far,
            "tangentInputRadians": tangent_inputs[0],
            "rowMajorMatrix": matrix,
        }

    cases = [
        project(default_fov, 1, far_cases[0]["farClip"]),
        project(default_fov, 2, far_cases[0]["farClip"]),
        project(60, 2, far_cases[1]["farClip"]),
        project(default_fov, 2, far_cases[2]["farClip"]),
    ]
    if cases[0]["rowMajorMatrix"][5] != cases[1]["rowMajorMatrix"][5]:
        raise ValueError("Changing aspect unexpectedly changed native vertical gain")
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(
            {
                "build": "16.23.840.6595",
                "decoderSha256": digest,
                "originalEntries": {
                    "cameraConfigInitializer": 0x22F890,
                    "cameraConfigFovRead": 0xC5CF76,
                    "cameraFovStore": 0xC5CFFF,
                    "cameraNearStore": 0xC5D33A,
                    "cameraFarProducer": 0xC5D344,
                    "cameraFarStore": 0xC5D36E,
                    "lensFovStore": 0xC5D7FE,
                    "projectionSelection": 0x184335B,
                    "perspectiveMatrix": 0x14B80F0,
                    "gameplayCameraSubobjectInitializer": 0xC8B400,
                    "gameplayCameraConfiguredDistanceTransfer": 0xC5CF48,
                    "gameplayFovDistanceScale": 0xC5D03D,
                    "gameplayEyeOffsetMagnitude": 0xC5E2C0,
                    "gameplayEyeOffset": 0xC5D5E9,
                },
                "defaultVerticalFovDegrees": default_fov,
                "nativePerspectiveNear": 50,
                "nativeDepthRange": [0, 1],
                "defaultGameplayPose": pose,
                "farClipSetting": {
                    "key": 0x16,
                    "originalFallback": 10000,
                    "cases": far_cases,
                    "scope": "The provider port returns the original fallback or a controlled override.",
                },
                "cases": cases,
                "scope": (
                    "Original initializer, object-field transfers, clip stores and projection. "
                    "Aspect and setting-provider responses are supplied. The tanf and sincos imports "
                    "use host math rounded to Float32. No viewport or replay camera was run."
                ),
            },
            file,
            allow_nan=False,
            indent=2,
        )


if __name__ == "__main__":
    main()
