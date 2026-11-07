"""Prepare exact-build fixed-speed motion constants and constructor defaults.

Executes two allocation-free constructor fragments on owned scratch. Metadata
registration is inspected, not initialized. No replay or game registry is read.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_64
import unicorn
from unicorn import x86_const as reg


def fnv(name):
    value = 2166136261
    for byte in name.lower().encode("ascii"):
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_text())
    image = (args.package / "image.bin").read_bytes()
    if (
        profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"]
    ):
        raise ValueError("Missile motion source mismatch")
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    base = profile["imageBase"]
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x10000)
    engine.mem_write(0x10000000, b"\xa5" * 0x10000)
    engine.reg_write(reg.UC_X86_REG_RDI, 0x10001000)
    engine.reg_write(reg.UC_X86_REG_RBX, 0x10001000)
    fragments = [(0x88602a, 0x88606b), (0x88607b, 0x88609c)]
    for start, end in fragments:
        engine.emu_start(base + start, base + end, count=10000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != base + end:
            raise ValueError("Constructor fragment instruction limit")
    snapshot = bytes(engine.mem_read(0x10001000, 0x60))

    # Bind native numeric field registrations to their constructor-written bytes.
    registrations = {}
    disassembler = Cs(CS_ARCH_X86, CS_MODE_64)
    for start, end in [(0x872a6f, 0x872b55), (0x8731b3, 0x873226)]:
        field_hash = offset = None
        for ins in disassembler.disasm(image[start:end], start):
            if ins.mnemonic == "mov" and ins.op_str.startswith("esi, "):
                field_hash = int(ins.op_str.split(", ")[1], 0)
            elif ins.mnemonic == "mov" and ins.op_str.startswith("edx, "):
                offset = int(ins.op_str.split(", ")[1], 0)
            elif ins.mnemonic == "call":
                if field_hash is None or offset is None:
                    raise ValueError("Unrecognized metadata registration")
                registrations[field_hash] = offset
                field_hash = offset = None
    types = {
        "mUseHeightOffsetAtEnd": "bool", "mTracksTarget": "bool",
        "mVisualsTrackHiddenTargets": "bool", "mTargetHeightAugment": "f32",
        "mOffsetInitialTargetHeight": "f32", "mStartDelay": "f32",
        "mProjectTargetToCastRange": "bool", "mUseGroundHeightAtTarget": "bool",
        "mInferDirectionFromFacingIfNeeded": "bool", "AddBonusAttackRangeToCastRange": "bool",
        "mSpeed": "f32",
    }
    fields = {}
    for name, field_type in types.items():
        offset = registrations[fnv(name)]
        if field_type == "bool":
            if snapshot[offset] not in [0, 1]:
                raise ValueError(f"Constructor did not write a bool {name}")
            value = bool(snapshot[offset])
        else:
            value = struct.unpack_from("<f", snapshot, offset)[0]
        fields[name] = {"offset": offset, "type": field_type, "hash": fnv(name), "default": value}
    result = {
        "schema": 1, "build": profile["clientVersion"],
        "sliceSha256": profile["sliceSha256"],
        "decoderImageSha256": profile["decoderImageSha256"],
        "className": "FixedSpeedMovement", "classHash": fnv("FixedSpeedMovement"),
        "specFactoryRva": 0x8743d0, "runtimeVtableRva": 0x235d018,
        "stepRva": 0x87f4e0, "vectorHelperRva": 0x148ddc0,
        "epsilon": struct.unpack_from("<f", image, 0x20ca4d0)[0],
        "epsilonRva": 0x20ca4d0, "fields": fields,
        "sourceBlocks": [{"startRva": start, "endRva": end, "sha256": hashlib.sha256(image[start:end]).hexdigest()}
                         for start, end in fragments + [(0x87f4e0, 0x87f559), (0x148ddc0, 0x148de6e),
                                                       (0x872a6f, 0x872b55), (0x8731b3, 0x873226)]],
        "scope": "Numeric spec defaults and one fixed-speed velocity/displacement routine only; target initialization, height, collision, lifetime and effects are separate",
    }
    destination = args.package / "missile-motion.json"
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["missileMotionSha256"] = hashlib.sha256(destination.read_bytes()).hexdigest()
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["missileMotionSha256"], "defaults": {k: v["default"] for k, v in fields.items()}}))


if __name__ == "__main__":
    main()
