"""Inspect original cast-plane selection, recorded starts and packet positions.

This runs original fragments on owned descriptors and native packet objects. It
does not model actor lookup, bones, runtime spell replacement or full playback.
The forced-recorded source branch seeds the start helper directly, avoiding a
fabricated caster registry. Packet position fields then use the full native
fixed-speed packet initializer, including later-keyframe creation positions.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as reg


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "scene", "missiles", "objects", "terrain", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    definition_bytes = (args.package / "missile-controllers.json").read_bytes()
    definition = json.loads(definition_bytes)
    manifest_bytes = (args.scene / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    height_bytes = (args.scene / "heights.bin").read_bytes()
    missile_bytes, objects_bytes, terrain_bytes = (p.read_bytes() for p in [args.missiles, args.objects, args.terrain])
    missiles, objects, terrain = (json.loads(b) for b in [missile_bytes, objects_bytes, terrain_bytes])
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(image) != profile["decoderImageSha256"]
        or sha(definition_bytes) != profile["missileControllersSha256"]
        or definition["decoderImageSha256"] != profile["decoderImageSha256"]
        or objects["decoderImageSha256"] != profile["decoderImageSha256"]
        or objects["constructorImageSha256"] != profile["constructorImageSha256"]
        or missiles["fieldCodecsSha256"] != profile["fieldCodecsSha256"]
        or missiles["missileControllersSha256"] != profile["missileControllersSha256"]
        or manifest["build"] != profile["clientVersion"]
        or missiles["build"] != manifest["build"] or missiles["protocol"] != manifest["protocol"]
        or terrain["decoderImageSha256"] != profile["decoderImageSha256"]
        or terrain["sceneManifestSha256"] != sha(manifest_bytes)
        or terrain["heightsSha256"] != sha(height_bytes)
        or terrain["mismatches"] or not terrain["loader"]["preparedSamplesMatch"]):
        raise ValueError("Missile initialization inspection package mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x2000000)
    stop, stack, manager, grid_at = 0x10000000, 0x10008000, 0x10001000, 0x10002000
    height_at = 0x10100000
    normalized, handle, resource = 0x10020000, 0x10021000, 0x10022000
    descriptor, seed, entity, motion, packet_at = 0x10024000, 0x10025000, 0x10026000, 0x10027000, 0x10028000
    grid = manifest["map"]["heightGrid"]
    engine.mem_write(grid_at + 0xbc, struct.pack("<fff", *manifest["map"]["min"]))
    engine.mem_write(grid_at + 0xc8, struct.pack("<fff", *manifest["map"]["max"]))
    engine.mem_write(grid_at + 0xf8, struct.pack("<Q", height_at))
    engine.mem_write(grid_at + 0x100, struct.pack("<IIff", grid["x"], grid["z"], *grid["step"]))
    engine.mem_write(height_at, height_bytes)
    engine.mem_write(manager + 8, struct.pack("<Q", grid_at))
    engine.mem_write(base + 0x246c948, struct.pack("<Q", manager))
    initial = engine.context_save()
    mask = (1 << 64) - 1
    ror = lambda n, k: ((n >> k) | (n << (64 - k))) & mask
    f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]
    vector = lambda at: list(struct.unpack("<fff", bytes(engine.mem_read(at, 12))))

    def fragment(entry, end, registers):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        engine.reg_write(reg.UC_X86_REG_RBP, stack + 0x1000)
        for register, value in registers.items():
            engine.reg_write(register, value)
        engine.emu_start(base + entry, base + end if end is not None else stop, count=10000)
        expected = base + end if end is not None else stop
        if engine.reg_read(reg.UC_X86_REG_RIP) != expected:
            raise ValueError(f"Native initialization instruction limit {entry:x}")

    buckets = {}
    for key, observation in objects["observations"].items():
        if observation["opcode"] != 28:
            continue
        if observation["status"] != "complete":
            raise ValueError("Incomplete native missile object")
        buckets.setdefault((observation["payloadSha256"], observation["param"]), []).append(observation)
    cases, bound = [], 0
    for record in missiles["records"]:
        bucket = buckets.get((record["payloadSha256"], record["contextId"]))
        if not bucket:
            raise ValueError("Missile record has no matching native payload/context")
        observation = bucket.pop(0)
        bound += 1
        start = record["startInitialization"]
        if start["status"] != "initialized":
            continue
        cast = record["cast"]
        engine.mem_write(normalized, bytes(0x200))
        engine.mem_write(resource, bytes(0x900))
        engine.mem_write(descriptor, bytes(0x40))
        engine.mem_write(normalized + 8, struct.pack("<Q", ror(handle ^ 0x3dc9cb21, 0x15)))
        engine.mem_write(handle + 0x80, struct.pack("<Q", (ror(resource, 0x11) - 0x80104765) & mask))
        engine.mem_write(normalized + 0x134, struct.pack("<f", cast["overrideScalar134"]))
        engine.mem_write(normalized + 0x14d, bytes([cast["overrideFlag14d"]]))
        engine.mem_write(normalized + 0x150, bytes([cast["forceRecordedSourcePosition"]]))
        engine.mem_write(normalized + 0xc8, struct.pack("<fff", *cast["sourcePosition"]))
        engine.mem_write(normalized + 0xd4, struct.pack("<fff", *cast["targetPosition"]))
        engine.mem_write(resource + 0x3f0, struct.pack("<I", start["settings"]["castType"] & 0xffffffff))
        engine.mem_write(resource + 0x4b0, struct.pack("<fff", *start["settings"]["particleStartOffset"]))
        fragment(0x8658e4, 0x86596b, {reg.UC_X86_REG_R14: normalized,
                 reg.UC_X86_REG_R15: 0x80104765, reg.UC_X86_REG_R12: 0})
        ground_rebase = bool(engine.reg_read(reg.UC_X86_REG_R12) & 255)
        offset_pointer = engine.reg_read(reg.UC_X86_REG_RBX)
        local_offset = vector(offset_pointer)
        # Original constructor's zeroed height fields and selected plane flag.
        fragment(0x874b47, 0x874b52, {reg.UC_X86_REG_RDI: descriptor,
                 reg.UC_X86_REG_RSI: int(ground_rebase)})
        fragment(0x874e50, 0x874e8d, {reg.UC_X86_REG_R14: normalized,
                 reg.UC_X86_REG_RBX: descriptor})
        engine.mem_write(seed, bytes(engine.mem_read(descriptor, 12)))
        fragment(0x874b60, None, {reg.UC_X86_REG_RDI: descriptor, reg.UC_X86_REG_RSI: normalized,
                 reg.UC_X86_REG_RDX: seed, reg.UC_X86_REG_RCX: offset_pointer})
        native_start = {"position": vector(descriptor),
            "planeHeightOffset": struct.unpack("<f", bytes(engine.mem_read(descriptor + 0xc, 4)))[0],
            "attachmentHeightOffset": struct.unpack("<f", bytes(engine.mem_read(descriptor + 0x10, 4)))[0],
            "groundRebase": ground_rebase, "localOffset": local_offset}
        sample = {"sequence": record["sequence"], "payloadSha256": record["payloadSha256"],
                  "entityId": record["entityId"], "start": native_start, "packetVariants": []}
        if record["packetInitialization"]["status"] == "initialized-position-fields":
            for native_flag_c1 in [False, True]:
                engine.mem_write(entity, bytes(0x500))
                engine.mem_write(motion, bytes(0x200))
                current = record["replicationPosition"] if record["elapsedSeconds"] > 0 else native_start["position"]
                engine.mem_write(entity + 0x15c, struct.pack("<fff", *current))
                engine.mem_write(entity + 0x358, struct.pack("<Q", descriptor))
                engine.mem_write(motion + 0x18, struct.pack("<Q", entity))
                engine.mem_write(motion + 0x7c, struct.pack("<fff", *record["targetInitialization"]["position"]))
                engine.mem_write(motion + 0x98, struct.pack("<f", record["settings"]["mTargetHeightAugment"]))
                engine.mem_write(motion + 0xc0, bytes([record["settings"]["mUseHeightOffsetAtEnd"], native_flag_c1]))
                raw = bytes.fromhex(observation["object"])
                if len(raw) != 632:
                    raise ValueError("Incompatible native missile packet size")
                engine.mem_write(packet_at, raw)
                fragment(0x88ae40, None, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: packet_at})
                values = {"nativeFlagC1": native_flag_c1,
                    "initialPosition": vector(motion + 0x70), "targetPosition": vector(motion + 0x7c),
                    "targetHeightAugment": struct.unpack("<f", bytes(engine.mem_read(motion + 0x98, 4)))[0],
                    "movementSpeed": struct.unpack("<f", bytes(engine.mem_read(motion + 0xa0, 4)))[0],
                    "untranslatedScalars": {hex(at): struct.unpack("<f", bytes(engine.mem_read(motion + at, 4)))[0]
                                             for at in [0xb0, 0xb4]}}
                sample["packetVariants"].append(values)
        cases.append(sample)
    selector_cases = []
    threshold = definition["constants"]["placementOverrideThreshold"]["value"]
    for cast_type in [0, 3, 9]:
        for flag in [0, 1, 255]:
            for scalar in [0, threshold, f(threshold * 2), -1, 1]:
                engine.mem_write(normalized, bytes(0x200))
                engine.mem_write(resource, bytes(0x900))
                engine.mem_write(normalized + 8, struct.pack("<Q", ror(handle ^ 0x3dc9cb21, 0x15)))
                engine.mem_write(handle + 0x80, struct.pack("<Q", (ror(resource, 0x11) - 0x80104765) & mask))
                engine.mem_write(normalized + 0x134, struct.pack("<f", scalar))
                engine.mem_write(normalized + 0x14d, bytes([flag]))
                engine.mem_write(resource + 0x3f0, struct.pack("<I", cast_type))
                engine.mem_write(resource + 0x4b0, struct.pack("<fff", 2, 3, 4))
                fragment(0x8658e4, 0x86596b, {reg.UC_X86_REG_R14: normalized,
                    reg.UC_X86_REG_R15: 0x80104765, reg.UC_X86_REG_R12: 0})
                selector_cases.append({"castType": cast_type, "overrideFlag14d": flag,
                    "overrideScalar134": scalar, "particleStartOffset": [2, 3, 4],
                    "groundRebase": bool(engine.reg_read(reg.UC_X86_REG_R12) & 255),
                    "localOffset": vector(engine.reg_read(reg.UC_X86_REG_RBX))})
    if bound != len(missiles["records"]) or bytes(engine.mem_read(height_at, len(height_bytes))) != height_bytes:
        raise ValueError("Missile initialization source coverage or terrain changed")
    result = {"schema": 1, "build": manifest["build"], "protocol": manifest["protocol"],
        "decoderImageSha256": profile["decoderImageSha256"], "fieldCodecsSha256": profile["fieldCodecsSha256"],
        "controllerDefinitionSha256": sha(definition_bytes), "missileInputsSha256": sha(missile_bytes),
        "nativeObjectsSha256": sha(objects_bytes), "terrainEvidenceSha256": sha(terrain_bytes),
        "nativeObjectsBound": bound, "cases": cases, "selectorCases": selector_cases,
        "scope": "Original cast-plane selector, recorded-source start fragments and full fixed-speed packet initializer on owned descriptors. No caster registry/bone seed, nonzero local-offset translation, runtime spell replacement, complete controller state or A/V playback admission"}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"nativeObjectsBound": bound, "starts": len(cases),
        "packetVariants": sum(len(c["packetVariants"]) for c in cases),
        "positiveElapsedStarts": sum(r["elapsedSeconds"] > 0 and r["startInitialization"]["status"] == "initialized"
                                     for r in missiles["records"]), "selectorCases": len(selector_cases)}))


if __name__ == "__main__":
    main()
