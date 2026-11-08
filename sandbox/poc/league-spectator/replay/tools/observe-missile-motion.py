"""Execute one original fixed-speed routine on recovered packet field inputs.

The inputs are owned controller/entity records, not fabricated game registries.
This inspects the component's math; it does not admit a whole missile controller.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as reg


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("getters", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_text())
    image = (args.package / "image.bin").read_bytes()
    motion_bytes = (args.package / "missile-motion.json").read_bytes()
    motion = json.loads(motion_bytes)
    getter_bytes = args.getters.read_bytes()
    getters = json.loads(getter_bytes)
    if (
        hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"]
        or hashlib.sha256(motion_bytes).hexdigest() != profile["missileMotionSha256"]
        or getters["decoderImageSha256"] != profile["decoderImageSha256"]
        or motion["decoderImageSha256"] != profile["decoderImageSha256"]
        or getters["build"] != profile["clientVersion"]
        or motion["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or motion["stepRva"] != 0x87f4e0
    ):
        raise ValueError("Missile motion inspection package mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x10000)
    initial = engine.context_save()
    cases = []
    for key, fields in getters["values"].items():
        if getters["opcodes"][key] != 28:
            continue
        position = fields["replicationPosition"] if fields["elapsedSeconds"] > 0 else fields["creationPosition"]
        for seconds in [1 / 60, 0.1, 0.25]:
            seconds = struct.unpack("<f", struct.pack("<f", seconds))[0]
            engine.context_restore(initial)
            engine.mem_write(0x10000000, bytes(0x10000))
            engine.mem_write(0x10001018, struct.pack("<Q", 0x10002000))
            engine.mem_write(0x1000107c, struct.pack("<fff", *fields["targetPosition"]))
            engine.mem_write(0x100010a0, struct.pack("<f", fields["movementSpeed"]))
            engine.mem_write(0x1000215c, struct.pack("<fff", *position))
            engine.mem_write(0x1000f008, struct.pack("<Q", 0x1000e000))
            engine.reg_write(reg.UC_X86_REG_RDI, 0x10001000)
            engine.reg_write(reg.UC_X86_REG_RSI, 0x10003000)
            engine.reg_write(reg.UC_X86_REG_RSP, 0x1000f008)
            engine.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", seconds))[0])
            engine.emu_start(base + motion["stepRva"], 0x1000e000, count=10000)
            if engine.reg_read(reg.UC_X86_REG_RIP) != 0x1000e000:
                raise ValueError(f"Native fixed-speed routine instruction limit {key}")
            output = bytes(engine.mem_read(0x10003004, 24))
            cases.append({
                "key": key, "position": position, "target": fields["targetPosition"],
                "speed": fields["movementSpeed"], "seconds": seconds,
                "velocityBits": list(struct.unpack_from("<III", output)),
                "displacementBits": list(struct.unpack_from("<III", output, 12)),
            })
    result = {
        "schema": 1, "build": profile["clientVersion"],
        "decoderImageSha256": profile["decoderImageSha256"],
        "missileMotionSha256": profile["missileMotionSha256"],
        "getterEvidenceSha256": hashlib.sha256(getter_bytes).hexdigest(),
        "scope": "One original velocity/displacement routine on recovered field inputs, irrespective of actual missile type; not controller initialization, trajectories or A/V validation",
        "cases": cases,
    }
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"packetInputs": len(cases) // 3, "nativeSteps": len(cases)}))


if __name__ == "__main__":
    main()
