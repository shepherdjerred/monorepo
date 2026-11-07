"""Prepare exact-build missile component, frame and height-solver metadata.

Static preparation reads no replay. Follow-terrain numeric defaults come from an
allocation-free original constructor fragment; imported powf remains external.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as reg
from macho import MachImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("client", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    source_bytes = args.client.read_bytes()
    source = MachImage(source_bytes)
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"]
        or hashlib.sha256(source.binary).hexdigest() != profile["sliceSha256"]
        or source.imports.get(0x1feeb3a) != "_powf"):
        raise ValueError("Missile controller source mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x1000)
    engine.mem_write(0x10000000, b"\xa5" * 0x1000)
    engine.reg_write(reg.UC_X86_REG_RAX, 0x10000000)
    engine.emu_start(base + 0x884e7e, base + 0x884e95, count=100)
    if engine.reg_read(reg.UC_X86_REG_RIP) != base + 0x884e95:
        raise ValueError("Follow-terrain constructor instruction limit")
    defaults = struct.unpack("<ff", bytes(engine.mem_read(0x10000008, 8)))
    engine.mem_write(0x10000000, b"\xa5" * 0x1000)
    engine.reg_write(reg.UC_X86_REG_RBX, 0x10000000)
    for a, b in [(0x896fb3, 0x896fbd), (0x8970d6, 0x8970ea)]:
        engine.emu_start(base + a, base + b, count=100)
        if engine.reg_read(reg.UC_X86_REG_RIP) != base + b:
            raise ValueError("Spell placement constructor fragment instruction limit")
    cast_type = struct.unpack("<I", bytes(engine.mem_read(0x100003f0, 4)))[0]
    start_offset = list(struct.unpack("<fff", bytes(engine.mem_read(0x100004b0, 12))))
    engine.mem_write(0x10000000, b"\xa5" * 0x1000)
    engine.reg_write(reg.UC_X86_REG_RBX, 0x10000000)
    engine.emu_start(base + 0x8639c2, base + 0x863a3b, count=100)
    if engine.reg_read(reg.UC_X86_REG_RIP) != base + 0x863a3b:
        raise ValueError("Missile runtime defaults fragment instruction limit")
    runtime_defaults = {name: bytes(engine.mem_read(0x10000000 + at, 1))[0]
        for name, at in [("phase", 0x368), ("phaseCount", 0x36b), ("stopped", 0x3c8), ("canPassOnce", 0x3ca)]}
    # These field identities are registered with the native spec offsets.
    for at, value in [(0x888eb4, 0xf7f6b610), (0x888ecf, 0xe3c3f079),
                      (0x89b679, 0x3a7f083f), (0x89b8fd, 0x6972767d)]:
        if struct.unpack_from("<I", image, at)[0] != value:
            raise ValueError("Height-solver field registration changed")
    constants = {
        "epsilon": (0x20ca034, "Completion/progress comparison epsilon"),
        "progressDefault": (0x20ca4a8, "Terminal/degenerate progress"),
        "blendedExponent": (0x20cbad0, "powf exponent"),
        "groundClearance": (0x20cbde8, "Blended-height terrain clearance"),
        "placementOverrideThreshold": (0x86592d + 0x186be13, "Cast-plane bypass threshold"),
        "normalizationEpsilon": (0x20ca4d0, "XYZ normalization squared-length epsilon"),
    }
    result = {
        "schema": 1, "build": profile["clientVersion"],
        "sliceSha256": profile["sliceSha256"],
        "decoderImageSha256": profile["decoderImageSha256"],
        "importSourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "arrivalRva": 0x88be60, "snapRva": 0x88bc40,
        "progressRva": 0x88d240,
        "frame": {
            "buildUpdateRva": 0x88d350, "stepRva": 0x88b760, "applyRva": 0x88a590,
            "constructorRva": 0x88a020, "fixedSpeedVtableRva": 0x235d018,
            "entityVtableRva": 0x235ae00, "clockGlobalRva": 0x88b901 + 0x1be16ff,
            "clockTimeRva": 0x15ed8e0, "clockDeltaRva": 0x15ed930,
            "runtimeDefaults": runtime_defaults,
            "correctionDisabledBits": 0x7f7fffff,
            "scope": "Original frame with owned allocation/memory, supplied float32 clock, and bounds-notification adapters; not complete actor/lifecycle or game presentation",
        },
        "verticalFacing": {"VerticalFacingFaceTarget": {"factoryRva": 0x874950,
            "evaluateRva": 0x8908c0, "normalizeRva": 0x148a750}},
        "startPlacement": {
            "selectRva": 0x8658e4, "selectEndRva": 0x86596b,
            "initializeRva": 0x874b60, "recordedSourceRva": 0x874e50,
            "fields": {"mCastType": {"hash": 0x3a7f083f, "offset": 0x3f0, "default": cast_type},
                       "mParticleStartOffset": {"hash": 0x6972767d, "offset": 0x4b0, "default": start_offset}},
        },
        "constants": {name: {"rva": at, "value": struct.unpack_from("<f", image, at)[0],
                             "meaning": meaning} for name, (at, meaning) in constants.items()},
        "heightSolvers": {
            "FollowTerrainHeightSolver": {
                "specVtableRva": 0x235d748, "factoryRva": 0x8728f0,
                "runtimeVtableRva": 0x235d660, "evaluateRva": 0x882800,
                "fields": {"mHeightOffset": {"hash": 0xf7f6b610, "offset": 8, "default": defaults[0]},
                           "mMaxSlope": {"hash": 0xe3c3f079, "offset": 12, "default": defaults[1]}},
            },
            "BlendedLinearHeightSolver": {
                "specVtableRva": 0x235d7c0, "factoryRva": 0x872930,
                "runtimeVtableRva": 0x235d788, "evaluateRva": 0x882770,
                "fields": {}, "externalMath": {"symbol": "_powf", "stubRva": 0x1feeb3a,
                    "importNameVerified": True,
                    "status": "Original macOS library implementation not captured"},
            },
        },
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": hashlib.sha256(image[a:b]).hexdigest()}
            for a, b in [(0x884e7e, 0x884e95), (0x888e6e, 0x888ee2),
                         (0x8728f0, 0x87295f), (0x882770, 0x8828a8),
                         (0x88be60, 0x88bfca), (0x148e6f0, 0x148e714),
                         (0x88bc40, 0x88bc84), (0x88d240, 0x88d326),
                         (0x896fb3, 0x896fbd), (0x8970d6, 0x8970ea),
                         (0x89b678, 0x89b687), (0x89b8fc, 0x89b90b),
                         (0x8658e4, 0x86596b), (0x874b30, 0x874b5f),
                         (0x874b60, 0x874e9a), (0x88ae40, 0x88b172),
                         (0x8639c2, 0x863a3b), (0x88d350, 0x88d3c3),
                         (0x88b760, 0x88bb51), (0x88a590, 0x88a640),
                         (0x8908c0, 0x890904), (0x148a750, 0x148a7ae),
                         (0x874950, 0x874964), (0x829cd0, 0x829cec)]] ,
        "scope": "Native component and no-target controller-frame entry points, defaults and constants. Owned frame probes adapt clock, memory, bounds notification and imported powf. Tracked targets, actor collision/phase/lifetime and VFX remain separate; original macOS powf equivalence is unverified",
    }
    for block in result["sourceBlocks"]:
        a, b = block["startRva"], block["endRva"]
        if image[a:b] != source.image[a:b]:
            raise ValueError("Controller instructions differ from original client slice")
    for item in result["constants"].values():
        at = item["rva"]
        if image[at:at + 4] != source.image[at:at + 4]:
            raise ValueError("Controller constants differ from original client slice")
    destination = args.package / "missile-controllers.json"
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["missileControllersSha256"] = hashlib.sha256(destination.read_bytes()).hexdigest()
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["missileControllersSha256"], "followTerrainDefaults": defaults,
                      "constants": {name: v["value"] for name, v in result["constants"].items()}}))


if __name__ == "__main__":
    main()
