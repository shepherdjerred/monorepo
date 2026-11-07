"""Inspect original missile getter blocks on decoded, exact-build packet objects.

This executes isolated original code; no game registries, terrain, handlers or UI.
The output is research evidence for field bytes, not flight or visual fidelity.
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
    parser.add_argument("observations", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_text())
    image = (args.package / "image.bin").read_bytes()
    observations = json.loads(args.observations.read_text())
    if (
        profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"]
        or observations["decoderImageSha256"] != profile["decoderImageSha256"]
        or observations["clientVersion"] != profile["clientVersion"]
        or observations["constructorImageSha256"] != profile["constructorImageSha256"]
    ):
        raise ValueError("Missile field inspection source mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x10000)
    initial = engine.context_save()
    blocks = {
        "creationPosition": (0x874ec9, 0x874f3a),
        "replicationPosition": (0x8796dc, 0x879996),
        "elapsedSeconds": (0x8795fd, 0x8796a3),
        "targetPosition": (0x82a5ad, 0x82a72f),
        "movementSpeed": (0x88b172, 0x88b241),
        "networkId": (0x82a509, 0x82a5a7),
        "sourcePosition": (0x82b619, 0x82b825),
        "sourceFlags": (0x82b319, 0x82b323),
        "forceRecordedSourcePosition": (0x82b319, 0x82b3ab),
        "overrideFlag14d": (0x82c6f8, 0x82c70e),
        "overrideScalar134": (0x82c718, 0x82c803),
        "controllerScalarB4": (0x88b247, 0x88b2e6),
        "controllerScalarB0": (0x88b2e6, 0x88b3c3),
        "pendingChildren": (0x878dc1, 0x878ddf),
        "replicationPhase": (0x878e28, 0x878e50),
        "initialPresentationByte": (0x87a8f2, 0x87a90c),
    }
    extra_blocks = {56: {"target": (0x87b6ea, 0x87b719)},
                    99: {"value": (0x87b8b4, 0x87b8db)}, 497: {},
                    1027: {name: blocks[name] for name in ["targetPosition", "networkId", "sourcePosition", "sourceFlags", "forceRecordedSourcePosition", "overrideFlag14d", "overrideScalar134"]}}
    result, opcodes = {}, {}
    for key, observation in observations["observations"].items():
        opcode = observation["opcode"]
        if opcode not in [28, 56, 99, 497, 1027]:
            continue
        packet = bytes.fromhex(observation["object"])
        if observation["status"] != "complete" or len(packet) != {28:632,56:20,99:24,497:16,1027:336}[opcode]:
            raise ValueError(f"Incomplete missile packet {key}")
        fields = {}
        for name, (start, end) in (blocks if opcode == 28 else extra_blocks[opcode]).items():
            engine.context_restore(initial)
            engine.mem_write(0x10000000, bytes(0x10000))
            engine.mem_write(0x10001000, packet)
            engine.reg_write(reg.UC_X86_REG_RSI, 0x10001000)
            engine.reg_write(reg.UC_X86_REG_RBX, 0x10001000)
            engine.reg_write(reg.UC_X86_REG_RDI, 0x10004000)
            engine.reg_write(reg.UC_X86_REG_R14, base + 0x20d8080)
            cast_base = 24 if opcode == 1027 else 168
            if name in ["targetPosition", "networkId", "sourcePosition", "sourceFlags", "forceRecordedSourcePosition", "overrideFlag14d", "overrideScalar134"]:
                engine.reg_write(reg.UC_X86_REG_R14, 0x10001000 + cast_base)
                engine.reg_write(reg.UC_X86_REG_RBX, 0x10004000)
                engine.reg_write(reg.UC_X86_REG_R15, base + 0x20d7800)
                engine.reg_write(reg.UC_X86_REG_R10, 0x10004000)
            if name in ["sourcePosition", "overrideFlag14d", "overrideScalar134"]:
                engine.reg_write(reg.UC_X86_REG_RBX, base + 0x20d7800)
            if name in ["movementSpeed", "controllerScalarB0", "controllerScalarB4"]:
                engine.reg_write(reg.UC_X86_REG_R14, 0x10001000)
                engine.reg_write(reg.UC_X86_REG_R12, base + 0x20d8440)
            engine.emu_start(base + start, base + end, count=10000)
            if engine.reg_read(reg.UC_X86_REG_RIP) != base + end:
                raise ValueError(f"Getter instruction limit {key}/{name}")
            if name == "forceRecordedSourcePosition":
                value = bytes(engine.mem_read(0x10004000 + 0x150, 1))[0]
                if value not in [0, 1]:
                    raise ValueError("Non-boolean native source position flag")
                fields[name] = bool(value)
            elif name in ["overrideFlag14d", "pendingChildren", "replicationPhase", "initialPresentationByte"]:
                fields[name] = engine.reg_read(reg.UC_X86_REG_EAX) & 255
            elif name == "sourceFlags":
                fields[name] = engine.reg_read(reg.UC_X86_REG_ECX) & 255
            elif opcode == 56:
                fields[name] = engine.reg_read(reg.UC_X86_REG_EAX) & 255
            elif opcode == 99:
                fields[name] = engine.reg_read(reg.UC_X86_REG_ESI) & 255
            elif name == "networkId":
                fields[name] = engine.reg_read(reg.UC_X86_REG_EAX)
            elif name in ["elapsedSeconds", "movementSpeed", "overrideScalar134", "controllerScalarB0", "controllerScalarB4"]:
                fields[name] = struct.unpack("<f", engine.reg_read(reg.UC_X86_REG_EAX).to_bytes(4, "little"))[0]
            else:
                address = {"creationPosition": 0x10004000, "replicationPosition": 0x10001000 + 540,
                           "targetPosition": 0x10004000 + 212,
                           "sourcePosition": 0x10001000 + cast_base + 32}[name]
                fields[name] = list(struct.unpack("<fff", bytes(engine.mem_read(address, 12))))
        result[key] = fields
        opcodes[key] = opcode
    output = {
        "schema": 1,
        "build": profile["clientVersion"],
        "decoderImageSha256": profile["decoderImageSha256"],
        "observationsSha256": hashlib.sha256(args.observations.read_bytes()).hexdigest(),
        "blocks": {name: {"entryRva": start, "endRva": end} for name, (start, end) in blocks.items()},
        "extraBlocks": {opcode: {name: {"entryRva": start, "endRva": end} for name, (start, end) in entries.items()} for opcode, entries in extra_blocks.items()},
        "opcodes": opcodes,
        "scope": "Original getters only; no trajectory, A/V or reference-client validation",
        "values": result,
    }
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"packets": len(result), "positiveElapsed": sum("elapsedSeconds" in v and v["elapsedSeconds"] > 0 for v in result.values())}))


if __name__ == "__main__":
    main()
