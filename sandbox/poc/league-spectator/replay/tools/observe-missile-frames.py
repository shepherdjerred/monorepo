"""Run complete original no-target controller frames on owned replay snapshots.

Clock values, allocation/memory services, bounds notification and imported powf
are explicit adapters. No game process, actor collision/lifetime or UI is run.
"""
import argparse
import ctypes
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
    for name in ["package", "scene", "missiles", "objects", "terrain", "initialization", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--actor-phases", action="store_true", help="Also execute native component factories and post-movement phase fragment")
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    definition_bytes = (args.package / "missile-controllers.json").read_bytes()
    definition = json.loads(definition_bytes)
    actor_bytes = (args.package / "missile-actors.json").read_bytes() if args.actor_phases else None
    actor_definition = json.loads(actor_bytes) if actor_bytes else None
    motion_bytes = (args.package / "missile-motion.json").read_bytes()
    motion_definition = json.loads(motion_bytes)
    manifest_bytes = (args.scene / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    heights = (args.scene / "heights.bin").read_bytes()
    missile_bytes, object_bytes, terrain_bytes, init_bytes = [p.read_bytes() for p in
        [args.missiles, args.objects, args.terrain, args.initialization]]
    missiles, objects, terrain, initialization = map(json.loads, [missile_bytes, object_bytes, terrain_bytes, init_bytes])
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(image) != profile["decoderImageSha256"]
        or sha(definition_bytes) != profile["missileControllersSha256"]
        or sha(motion_bytes) != profile["missileMotionSha256"]
        or missiles["missileControllersSha256"] != sha(definition_bytes)
        or missiles["fieldCodecsSha256"] != profile["fieldCodecsSha256"]
        or missiles["build"] != manifest["build"] or manifest["build"] != profile["clientVersion"]
        or missiles["protocol"] != manifest["protocol"] or manifest["protocol"] != profile["protocolDigest"]
        or terrain["sceneManifestSha256"] != sha(manifest_bytes) or terrain["heightsSha256"] != sha(heights)
        or terrain["decoderImageSha256"] != profile["decoderImageSha256"]
        or terrain["mismatches"] or not terrain["loader"]["preparedSamplesMatch"]
        or initialization["missileInputsSha256"] != sha(missile_bytes)
        or initialization["controllerDefinitionSha256"] != sha(definition_bytes)
        or initialization["fieldCodecsSha256"] != profile["fieldCodecsSha256"]
        or initialization["startMismatches"] or initialization["packetMismatches"] or initialization["selectorMismatches"]
        or objects["decoderImageSha256"] != profile["decoderImageSha256"]
        or objects["constructorImageSha256"] != profile["constructorImageSha256"]):
        raise ValueError("Missile frame source/evidence mismatch")
    if actor_definition and (sha(actor_bytes) != profile["missileActorsSha256"]
        or missiles["missileActorsSha256"] != profile["missileActorsSha256"]
        or actor_definition["decoderImageSha256"] != profile["decoderImageSha256"]):
        raise ValueError("Missile actor/frame package mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x2000000)
    stop, stack, manager, grid_at, clock_manager = 0x10000000, 0x10010008, 0x10001000, 0x10002000, 0x10003000
    entity, motion, update, solver, spec, target, descriptor, packet = [0x10020000 + i * 0x1000 for i in range(8)]
    behavior_spec, presentation = 0x10028000, 0x10029000
    height_at, heap_at, heap_end = 0x10100000, 0x10400000, 0x12000000
    engine.mem_write(base + definition["frame"]["clockGlobalRva"], struct.pack("<Q", clock_manager))
    engine.mem_write(clock_manager + 0x10, struct.pack("<Q", clock_manager + 0x100))
    grid = manifest["map"]["heightGrid"]
    engine.mem_write(grid_at + 0xbc, struct.pack("<fff", *manifest["map"]["min"]))
    engine.mem_write(grid_at + 0xc8, struct.pack("<fff", *manifest["map"]["max"]))
    engine.mem_write(grid_at + 0xf8, struct.pack("<Q", height_at))
    engine.mem_write(grid_at + 0x100, struct.pack("<IIff", grid["x"], grid["z"], *grid["step"]))
    engine.mem_write(height_at, heights)
    engine.mem_write(manager + 8, struct.pack("<Q", grid_at))
    engine.mem_write(base + 0x246c948, struct.pack("<Q", manager))
    initial = engine.context_save()
    f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]
    bits = lambda n: int.from_bytes(struct.pack("<f", n), "little")
    read_f = lambda at: struct.unpack("<f", bytes(engine.mem_read(at, 4)))[0]
    read_q = lambda at: struct.unpack("<Q", bytes(engine.mem_read(at, 8)))[0]
    vector_bits = lambda at: list(struct.unpack("<III", bytes(engine.mem_read(at, 12))))
    put_vec = lambda at, v: engine.mem_write(at, struct.pack("<fff", *v))
    crt = Path("C:/Windows/System32/ucrtbase.dll")
    powf = ctypes.CDLL(str(crt)).powf
    powf.argtypes, powf.restype = [ctypes.c_float, ctypes.c_float], ctypes.c_float
    clock = {"time": 0.0, "delta": 0.0}
    service_counts, allocations = {}, {}
    next_heap, presentation_stops = heap_at, 0

    def service(uc, address, size, user):
        nonlocal next_heap, presentation_stops
        rva = address - base
        service_counts[hex(rva)] = service_counts.get(hex(rva), 0) + 1
        if rva == 0x1474a30:
            count = uc.reg_read(reg.UC_X86_REG_RDI)
            if not 0 < count <= 0x100000 or next_heap + count > heap_end:
                raise ValueError("Owned frame allocator bounds")
            at = next_heap
            next_heap = (at + count + 15) & ~15
            allocations[at] = count
            # Allocation bytes are deliberately not assumed zero by native code.
            uc.mem_write(at, b"\xa5" * count)
            uc.reg_write(reg.UC_X86_REG_RAX, at)
        elif rva == 0x1474970:
            at = uc.reg_read(reg.UC_X86_REG_RDI)
            if at and at not in allocations:
                raise ValueError("Free outside owned frame allocations")
            if at:
                del allocations[at]
        elif rva in [0x1feea44, 0x1feea4a]:
            dest, source, count = [uc.reg_read(r) for r in [reg.UC_X86_REG_RDI, reg.UC_X86_REG_RSI, reg.UC_X86_REG_RDX]]
            if count:
                if not (heap_at <= dest <= heap_end - count and heap_at <= source <= heap_end - count):
                    raise ValueError("Memory copy outside owned frame heap")
                uc.mem_write(dest, bytes(uc.mem_read(source, count)))
            uc.reg_write(reg.UC_X86_REG_RAX, dest)
        elif rva in [0x15ed8e0, 0x15ed930]:
            uc.reg_write(reg.UC_X86_REG_XMM0, bits(clock["time" if rva == 0x15ed8e0 else "delta"]))
        elif rva == 0x1feeb3a:
            a, b = [struct.unpack("<f", (uc.reg_read(r) & 0xffffffff).to_bytes(4, "little"))[0]
                    for r in [reg.UC_X86_REG_XMM0, reg.UC_X86_REG_XMM1]]
            uc.reg_write(reg.UC_X86_REG_XMM0, bits(powf(a, b)))
        elif rva == 0x865060:
            if uc.reg_read(reg.UC_X86_REG_RDI) != entity:
                raise ValueError("Bounds notification for unowned entity")
        elif rva == 0x8950e0:
            if not args.actor_phases or uc.reg_read(reg.UC_X86_REG_RDI) != presentation:
                raise ValueError("Stop notification for unowned presentation")
            presentation_stops += 1
        else:
            raise ValueError("Unexpected frame service")
        rsp = uc.reg_read(reg.UC_X86_REG_RSP)
        uc.reg_write(reg.UC_X86_REG_RIP, read_q(rsp))
        uc.reg_write(reg.UC_X86_REG_RSP, rsp + 8)

    admitted_services = [0x1474a30, 0x1474970, 0x1feea4a, 0x15ed8e0, 0x15ed930, 0x1feeb3a, 0x865060]
    if args.actor_phases:
        admitted_services += [0x1feea44, 0x8950e0]
    for rva in admitted_services:
        engine.hook_add(unicorn.UC_HOOK_CODE, service, begin=base + rva, end=base + rva)

    def reject_other_decoder_service(uc, address, size, user):
        raise ValueError(f"Frame entered unadmitted modeled decoder service {address-base:x}")

    for patch in profile["modeledServices"]:
        if patch["rva"] not in admitted_services:
            engine.hook_add(unicorn.UC_HOOK_CODE, reject_other_decoder_service,
                begin=base + patch["rva"], end=base + patch["rva"] + len(bytes.fromhex(patch["bytesHex"])) - 1)

    def call(entry, registers, end=None):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        engine.reg_write(reg.UC_X86_REG_RBP, stack + 0x1000)
        for register, value in registers.items():
            engine.reg_write(register, value)
        expected = base + end if end is not None else stop
        try:
            engine.emu_start(base + entry, expected, count=50000)
        except unicorn.UcError as error:
            raise ValueError(f"Frame native fault entry={entry:x} rip={engine.reg_read(reg.UC_X86_REG_RIP)-base:x}") from error
        if engine.reg_read(reg.UC_X86_REG_RIP) != expected:
            raise ValueError(f"Frame native instruction limit {entry:x}")

    def eligible(record):
        return (record["movementType"] == "FixedSpeedMovement" and not record["settings"]["mTracksTarget"]
            and record["cast"]["targetCount"] == 0 and record["settings"]["mStartDelay"] == 0
            and record["packetInitialization"]["status"] == "initialized-position-fields"
            and bits(record["controllerScalarB0"]) == definition["frame"]["correctionDisabledBits"]
            and record["controllerScalarB4"] == 0 and not record["uninterpretedMovementFields"]
            and record["heightController"]["status"] in ["none", "translated", "translated-external-powf-unverified"]
            and not record["heightController"].get("uninterpretedFields")
            and record["verticalFacingType"] in [None, "VerticalFacingFaceTarget"]
            and (not args.actor_phases or (not record["phaseAdmission"]["reasons"] and record["pendingChildren"] == 0)))

    def actor_snapshot():
        byte = lambda at: bytes(engine.mem_read(entity + at, 1))[0]
        values = {name: byte(at) for name, at in [("phase", 0x368), ("deferredPhase", 0x369),
            ("pendingChildren", 0x36a), ("phaseCount", 0x36b)]}
        values.update({name: bool(byte(at)) for name, at in [("phaseLatch", 0x36d), ("stopped", 0x3c8),
            ("renderParticlesAfterDestroy", 0x350)]})
        values["velocity"] = list(struct.unpack("<fff", bytes(engine.mem_read(entity + 0x58, 12))))
        values["presentationStopCalls"] = presentation_stops
        components = []
        for at in range(read_q(entity + 0x3b0), read_q(entity + 0x3b8), 8):
            component = read_q(at)
            type_name = next((name for name, item in actor_definition["behaviors"].items()
                if item["runtimeVtableRva"] == read_q(component) - base), None)
            if type_name is None:
                raise ValueError("Unknown frame phase component")
            item = {"type": type_name}
            if type_name == "DestroyOnMovementComplete":
                action = read_q(read_q(component + 0x10))
                item.update(remainingDelay=struct.unpack("<i", bytes(engine.mem_read(component + 0x28, 4)))[0],
                    fired=bool(bytes(engine.mem_read(component + 0x2c, 1))[0]),
                    actionExecuted=bool(bytes(engine.mem_read(action + 8, 1))[0]))
            components.append(item)
        values["components"] = components
        return values

    buckets = {}
    for observation in objects["observations"].values():
        if observation["opcode"] == 28:
            buckets.setdefault((observation["payloadSha256"], observation["param"]), []).append(observation)
    cases = []
    for record in missiles["records"]:
        bucket = buckets.get((record["payloadSha256"], record["contextId"]))
        if not bucket:
            raise ValueError("Unmatched original missile object")
        observation = bucket.pop(0)
        if not eligible(record):
            continue
        if observation["status"] != "complete":
            raise ValueError("Incomplete eligible missile object")
        for seconds in [f(1/60), f(1/30), f(0.1), f(0.001), f(0.0005)]:
            next_heap, allocations, presentation_stops = heap_at, {}, 0
            clock.update(time=0.0, delta=seconds)
            engine.mem_write(entity, bytes(0x8000))
            engine.mem_write(entity, struct.pack("<Q", base + definition["frame"]["entityVtableRva"]))
            call(0x8639bb if args.actor_phases else 0x8639c2, {reg.UC_X86_REG_RBX: entity}, end=0x863a3b)
            packet_init, start = record["packetInitialization"], record["startInitialization"]
            put_vec(entity + 0x15c, packet_init["currentPosition"])
            engine.mem_write(entity + 0x358, struct.pack("<Q", descriptor))
            put_vec(descriptor, start["position"])
            engine.mem_write(descriptor + 0xc, struct.pack("<ff", start["planeHeightOffset"], start["attachmentHeightOffset"]))
            call(0x88602a, {reg.UC_X86_REG_RDI: spec}, end=0x88606b)
            call(0x88607b, {reg.UC_X86_REG_RBX: spec}, end=0x88609c)
            for name, field in motion_definition["fields"].items():
                value = record["settings"][name]
                engine.mem_write(spec + field["offset"], struct.pack("<?" if field["type"] == "bool" else "<f", value))
            # Forced recorded placement bypasses the static start-bone seed;
            # there is no target bone in the admitted movement properties.
            put_vec(target, record["targetInitialization"]["position"])
            call(0x88a020, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: entity,
                reg.UC_X86_REG_EDX: 0, reg.UC_X86_REG_RCX: target, reg.UC_X86_REG_R8: spec})
            engine.mem_write(motion, struct.pack("<Q", base + definition["frame"]["fixedSpeedVtableRva"]))
            engine.mem_write(packet, bytes.fromhex(observation["object"]))
            call(0x88ae40, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: packet})
            height = record["heightController"]
            if height["type"]:
                meta = definition["heightSolvers"][height["type"]]
                engine.mem_write(solver, struct.pack("<Q", base + meta["runtimeVtableRva"]))
                for name, field in meta["fields"].items():
                    engine.mem_write(solver + field["offset"], struct.pack("<f", height["settings"][name]))
                engine.mem_write(motion + 0x30, struct.pack("<Q", solver))
            if record["verticalFacingType"]:
                call(0x874950, {reg.UC_X86_REG_RSI: motion})
            if args.actor_phases:
                engine.mem_write(entity + 0x348, struct.pack("<Q", presentation))
                pointer = motion ^ 0x453b8f8b
                pointer = ((((pointer << 53) | (pointer >> 11)) + 0x453b8f8b) & ((1 << 64) - 1)) ^ 0x496e69c7
                engine.mem_write(entity + 0x340, struct.pack("<Q", pointer))
                for behavior in record["behaviorSpecs"]:
                    meta = actor_definition["behaviors"][behavior["__type"]]
                    engine.mem_write(behavior_spec, bytes(0x80))
                    engine.mem_write(behavior_spec, struct.pack("<Q", base + meta["specVtableRva"]))
                    for name, field in meta["fields"].items():
                        engine.mem_write(behavior_spec + field["offset"], struct.pack("<?" if field["type"] == "bool" else "<i",
                            behavior.get(name, field["default"])))
                    call(meta["factoryRva"], {reg.UC_X86_REG_RDI: behavior_spec, reg.UC_X86_REG_RSI: entity})
                pending_start, pending_end = read_q(entity + 0x3d0), read_q(entity + 0x3d8)
                call(0x86cc70, {reg.UC_X86_REG_RDI: entity + 0x3b0, reg.UC_X86_REG_RSI: read_q(entity + 0x3b8),
                    reg.UC_X86_REG_RDX: pending_start, reg.UC_X86_REG_RCX: pending_end,
                    reg.UC_X86_REG_R8: (pending_end - pending_start)//8})
                engine.mem_write(entity + 0x3d8, struct.pack("<Q", pending_start))
                call(0x878dc1, {reg.UC_X86_REG_RBX: packet, reg.UC_X86_REG_R13: entity}, end=0x878e59)
                call(0x865c77, {reg.UC_X86_REG_R15: entity}, end=0x865cc3)
            initial_state = {"positionBits": vector_bits(entity + 0x15c), "initialPositionBits": vector_bits(motion + 0x70),
                "targetPositionBits": vector_bits(motion + 0x7c), "speedBits": bits(read_f(motion + 0xa0)),
                "correctionBits": bits(read_f(motion + 0xb0)), "correctionDeltaBits": bits(read_f(motion + 0xb4)),
                "arrivalRadiusBits": bits(read_f(motion + 0x9c)), "targetRef": read_q(motion + 0x28),
                "canPassOnce": bool(bytes(engine.mem_read(entity + 0x3ca, 1))[0])}
            if args.actor_phases:
                initial_state["actorState"] = actor_snapshot()
                if initial_state["actorState"]["stopped"]:
                    raise ValueError("Initial phase stopped this owned flight before its controller frame")
            frames = []
            for index in range(4096):
                clock["time"] = f(clock["time"] + seconds)
                call(0x88d350, {reg.UC_X86_REG_RDI: update, reg.UC_X86_REG_RSI: motion})
                call(0x88b760, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: update})
                sample = {"time": clock["time"], "velocityBits": vector_bits(update + 4),
                    "displacementBits": vector_bits(update + 0x10),
                    "speedBits": bits(read_f(update)), "arrived": bool(bytes(engine.mem_read(update + 0x1c, 1))[0]),
                    "canPassOnce": bool(bytes(engine.mem_read(entity + 0x3ca, 1))[0]),
                    "historySize": read_q(motion + 0x68)}
                history_start, history_map = read_q(motion + 0x60), read_q(motion + 0x48)
                history_bytes = bytearray()
                for offset in range(sample["historySize"]):
                    block, lane = divmod(history_start + offset, 341)
                    history_bytes += engine.mem_read(read_q(history_map + block * 8) + lane * 12, 12)
                sample["historySha256"] = sha(history_bytes)
                call(0x88a590, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: update})
                sample.update(positionBits=vector_bits(entity + 0x15c), appliedVelocityBits=vector_bits(entity + 0x58))
                if args.actor_phases:
                    call(0x864875, {reg.UC_X86_REG_RBX: entity, reg.UC_X86_REG_R14: motion}, end=0x8649e2)
                    sample["actorState"] = actor_snapshot()
                frames.append(sample)
                if sample["arrived"]:
                    break
            else:
                raise ValueError("Owned frame trajectory did not arrive within bounded clock")
            cases.append({"sequence": record["sequence"], "payloadSha256": record["payloadSha256"],
                "entityId": record["entityId"], "seconds": seconds, "initial": initial_state, "frames": frames})
    if bytes(engine.mem_read(height_at, len(heights))) != heights:
        raise ValueError("Frame probe mutated terrain")
    result = {"schema": 1, "build": manifest["build"], "protocol": manifest["protocol"],
        "decoderImageSha256": profile["decoderImageSha256"], "controllerDefinitionSha256": sha(definition_bytes),
        "motionDefinitionSha256": sha(motion_bytes), "fieldCodecsSha256": profile["fieldCodecsSha256"],
        "missileInputsSha256": sha(missile_bytes), "nativeObjectsSha256": sha(object_bytes),
        "sceneManifestSha256": sha(manifest_bytes), "heightsSha256": sha(heights),
        "terrainEvidenceSha256": sha(terrain_bytes), "initializationEvidenceSha256": sha(init_bytes),
        "services": {"calls": service_counts, "clock": "Supplied float32 time/delta, not original game clock provider or recorded frame schedule",
            "memory": "Bounded owned allocator/free/memmove; native deque and 60-position history code execute",
            "bounds": "Original position setter executes; bounds/child registration notification adapted to no-op",
            "powf": {"adapter": str(crt), "adapterSha256": sha(crt.read_bytes()), "originalMacosImplementationVerified": False}},
        "scope": "Complete original no-target FixedSpeed controller frame and apply on owned replay snapshots at supplied clocks; no actor collisions, phase handlers, stop/lifetime, original macOS powf, rendered effects or reference-client validation",
        "cases": cases}
    if args.actor_phases:
        result["actorDefinitionSha256"] = sha(actor_bytes)
        result["services"]["presentation"] = "Stop callback counted, not a rendered backend"
        result["scope"] = "Original controller initialization/frame/apply composed with native component factories and actor post-movement phase fragment on owned no-child snapshots. Supplied clock, bounds and Windows powf adapters; no actor owner/type prefilters, collision/hit/cast/child dispatch, actual recorded phase timing, particles or reference playback"
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "records": len(cases)//5, "frames": sum(len(c["frames"]) for c in cases),
        "services": service_counts}))


if __name__ == "__main__":
    main()
