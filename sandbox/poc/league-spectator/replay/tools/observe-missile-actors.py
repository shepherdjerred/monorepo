"""Execute original phase/stop/component code on owned no-child missile actors.

Real packets and notifications remain separate from controlled branch probes.
The presentation-stop callback is observed, not rendered. Movement, collision,
registries, child objects, A/V and an actual replay frame schedule are not run.
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
    for name in ["package", "missiles", "objects", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--events", nargs=2, type=Path, metavar=("NATIVE", "CORPUS"))
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    definition_bytes = (args.package / "missile-actors.json").read_bytes()
    definition = json.loads(definition_bytes)
    codec_bytes = (args.package / "field-codecs.json").read_bytes()
    codecs = json.loads(codec_bytes)["codecs"]
    missile_bytes, object_bytes = args.missiles.read_bytes(), args.objects.read_bytes()
    missiles, objects = json.loads(missile_bytes), json.loads(object_bytes)
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(image) != profile["decoderImageSha256"] or sha(definition_bytes) != profile["missileActorsSha256"]
        or definition["decoderImageSha256"] != profile["decoderImageSha256"]
        or definition["sliceSha256"] != profile["sliceSha256"]
        or sha(codec_bytes) != profile["fieldCodecsSha256"]
        or missiles["fieldCodecsSha256"] != profile["fieldCodecsSha256"]
        or missiles["missileActorsSha256"] != profile["missileActorsSha256"]
        or objects["decoderImageSha256"] != profile["decoderImageSha256"]
        or objects["constructorImageSha256"] != profile["constructorImageSha256"]
        or missiles["build"] != profile["clientVersion"] or missiles["protocol"] != profile["protocolDigest"]):
        raise ValueError("Missile actor source mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    scratch, heap_start, heap_end = 0x10000000, 0x10400000, 0x12000000
    engine.mem_map(scratch, 0x2000000)
    stop, stack, actor, packet_at, spec_at, motion, presentation = [scratch + at for at in
        [0, 0x10008, 0x20000, 0x22000, 0x24000, 0x25000, 0x26000]]
    initial = engine.context_save()
    next_heap, allocations, notification_calls, service_counts = heap_start, {}, 0, {}
    q = lambda at: struct.unpack("<Q", bytes(engine.mem_read(at, 8)))[0]
    b = lambda at: bytes(engine.mem_read(at, 1))[0]

    def service(uc, address, size, user):
        nonlocal next_heap, notification_calls
        rva = address - base
        service_counts[hex(rva)] = service_counts.get(hex(rva), 0) + 1
        if rva == 0x1474a30:
            size = uc.reg_read(reg.UC_X86_REG_RDI)
            if not 0 < size <= 0x100000 or next_heap + size > heap_end:
                raise ValueError("Actor owned allocator bounds")
            at = next_heap
            next_heap = (at + size + 15) & ~15
            allocations[at] = size
            uc.mem_write(at, b"\xa5" * size)
            uc.reg_write(reg.UC_X86_REG_RAX, at)
        elif rva == 0x1474970:
            at = uc.reg_read(reg.UC_X86_REG_RDI)
            if at and at not in allocations:
                raise ValueError("Actor free outside owned allocations")
            if at:
                del allocations[at]
        elif rva in [0x1feea44, 0x1feea4a]:
            dest, source, count = [uc.reg_read(r) for r in [reg.UC_X86_REG_RDI, reg.UC_X86_REG_RSI, reg.UC_X86_REG_RDX]]
            if count:
                if not (heap_start <= dest <= heap_end - count and heap_start <= source <= heap_end - count):
                    raise ValueError("Actor copy outside owned vectors")
                uc.mem_write(dest, bytes(uc.mem_read(source, count)))
            uc.reg_write(reg.UC_X86_REG_RAX, dest)
        elif rva == 0x8950e0:
            if uc.reg_read(reg.UC_X86_REG_RDI) != presentation:
                raise ValueError("Stop for unowned presentation descriptor")
            notification_calls += 1
        else:
            raise ValueError("Unknown actor service")
        rsp = uc.reg_read(reg.UC_X86_REG_RSP)
        uc.reg_write(reg.UC_X86_REG_RIP, q(rsp))
        uc.reg_write(reg.UC_X86_REG_RSP, rsp + 8)

    admitted = [0x1474a30, 0x1474970, 0x1feea44, 0x1feea4a, 0x8950e0]
    for rva in admitted:
        engine.hook_add(unicorn.UC_HOOK_CODE, service, begin=base + rva, end=base + rva)

    def reject(uc, address, size, user):
        raise ValueError(f"Actor entered unadmitted decoder service {address-base:x}")

    for patch in profile["modeledServices"]:
        if patch["rva"] not in admitted:
            engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + patch["rva"],
                end=base + patch["rva"] + len(bytes.fromhex(patch["bytesHex"])) - 1)

    def call(entry, registers, end=None):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        engine.reg_write(reg.UC_X86_REG_RBP, stack + 0x1000)
        for register, value in registers.items():
            engine.reg_write(register, value)
        expected = base + end if end is not None else stop
        try:
            engine.emu_start(base + entry, expected, count=1000000)
        except unicorn.UcError as error:
            raise ValueError(f"Native actor fault {entry:x} rip={engine.reg_read(reg.UC_X86_REG_RIP)-base:x}") from error
        if engine.reg_read(reg.UC_X86_REG_RIP) != expected:
            raise ValueError(f"Native actor instruction limit {entry:x}")

    def field_encode(name, value):
        table = codecs[name]["decode"][0]
        return bytes([table.index(value)])

    def supported(specs):
        return isinstance(specs, list) and all(spec.get("__type") in definition["behaviors"] and
            all(key == "__type" or key in definition["behaviors"][spec["__type"]]["fields"] for key in spec) for spec in specs)

    def drain():
        pending_start, pending_end = q(actor + 0x3d0), q(actor + 0x3d8)
        call(0x86cc70, {reg.UC_X86_REG_RDI: actor + 0x3b0, reg.UC_X86_REG_RSI: q(actor + 0x3b8),
            reg.UC_X86_REG_RDX: pending_start, reg.UC_X86_REG_RCX: pending_end,
            reg.UC_X86_REG_R8: (pending_end - pending_start)//8})
        engine.mem_write(actor + 0x3d8, struct.pack("<Q", pending_start))

    def snapshot():
        values = {name: b(actor + at) for name, at in [("phase", 0x368), ("deferredPhase", 0x369),
            ("pendingChildren", 0x36a), ("phaseCount", 0x36b)]}
        values.update({name: bool(b(actor + at)) for name, at in [("phaseLatch", 0x36d), ("stopped", 0x3c8),
            ("renderParticlesAfterDestroy", 0x350)]})
        values["velocity"] = list(struct.unpack("<fff", bytes(engine.mem_read(actor + 0x58, 12))))
        values["presentationStopCalls"] = notification_calls
        values["components"] = []
        for at in range(q(actor + 0x3b0), q(actor + 0x3b8), 8):
            component = q(at)
            vtable = q(component) - base
            name = next((name for name, meta in definition["behaviors"].items() if meta["runtimeVtableRva"] == vtable), None)
            if name is None:
                raise ValueError("Unprepared native phase component")
            item = {"type": name}
            if name == "DestroyOnMovementComplete":
                actions, actions_end = q(component + 0x10), q(component + 0x18)
                if actions_end - actions != 8:
                    raise ValueError("Unexpected native stop action count")
                item.update(remainingDelay=struct.unpack("<i", bytes(engine.mem_read(component + 0x28, 4)))[0],
                    fired=bool(b(component + 0x2c)), actionExecuted=bool(b(q(actions) + 8)))
            values["components"].append(item)
        return values

    def run_case(record, raw, operations, scope):
        nonlocal next_heap, allocations, notification_calls
        next_heap, allocations, notification_calls = heap_start, {}, 0
        engine.mem_write(actor, bytes(0x8000))
        engine.mem_write(actor, struct.pack("<Q", base + 0x235ae00))
        call(0x8639bb, {reg.UC_X86_REG_RBX: actor}, end=0x863a3b)
        engine.mem_write(actor + 0x348, struct.pack("<Q", presentation))
        velocity = [1.25, -3.5, 7.75]
        engine.mem_write(actor + 0x58, struct.pack("<fff", *velocity))
        engine.mem_write(motion, struct.pack("<Q", base + 0x235d018))
        mask = (1 << 64) - 1
        value = motion ^ 0x453b8f8b
        value = (((value << 53) | (value >> 11)) + 0x453b8f8b) & mask
        engine.mem_write(actor + 0x340, struct.pack("<Q", value ^ 0x496e69c7))
        for spec in record["behaviorSpecs"]:
            meta = definition["behaviors"][spec["__type"]]
            engine.mem_write(spec_at, bytes(0x80))
            engine.mem_write(spec_at, struct.pack("<Q", base + meta["specVtableRva"]))
            for name, field in meta["fields"].items():
                value = spec.get(name, field["default"])
                engine.mem_write(spec_at + field["offset"], struct.pack("<?" if field["type"] == "bool" else "<i", value))
            call(meta["factoryRva"], {reg.UC_X86_REG_RDI: spec_at, reg.UC_X86_REG_RSI: actor})
        drain()
        engine.mem_write(packet_at, raw)
        call(0x878dc1, {reg.UC_X86_REG_RBX: packet_at, reg.UC_X86_REG_R13: actor}, end=0x878e59)
        call(0x865c77, {reg.UC_X86_REG_R15: actor}, end=0x865cc3)
        output = {"scope": scope, "record": record, "initialVelocity": velocity, "initial": snapshot(), "operations": []}
        for operation, packet in operations:
            if packet is not None:
                engine.mem_write(packet_at, packet)
            if operation["type"] == "phase-notification":
                call(0x87b6e0, {reg.UC_X86_REG_RDI: actor, reg.UC_X86_REG_RSI: packet_at})
            elif operation["type"] == "stop-notification":
                call(0x87a930, {reg.UC_X86_REG_RDI: actor, reg.UC_X86_REG_RSI: packet_at})
            elif operation["type"] == "release-child-gate":
                call(0x86544d, {reg.UC_X86_REG_RBX: actor}, end=0x865527)
            elif operation["type"] == "post-movement-fragment":
                engine.mem_write(motion + 0xac, bytes([operation["arrived"]]))
                call(0x864875, {reg.UC_X86_REG_RBX: actor, reg.UC_X86_REG_R14: motion}, end=0x8649e2)
            else:
                raise ValueError("Unprepared actor probe operation")
            output["operations"].append({**operation, "state": snapshot()})
        return output

    event_by_location, event_source = {}, None
    if args.events:
        event_bytes, corpus_bytes = [p.read_bytes() for p in args.events]
        events, corpus = json.loads(event_bytes), json.loads(corpus_bytes)
        if (events["decoderImageSha256"] != profile["decoderImageSha256"]
            or events["constructorImageSha256"] != profile["constructorImageSha256"]
            or corpus["build"] != missiles["build"] or corpus["protocol"] != missiles["protocol"]
            or corpus["replaySha256"] != missiles["replaySha256"]):
            raise ValueError("Actor event source mismatch")
        for key, sample in corpus["packets"].items():
            if sample["opcode"] not in [56, 497]:
                continue
            observation = events["observations"][key]
            if (observation["status"] != "complete" or observation["opcode"] != sample["opcode"]
                or observation["param"] != sample["param"]
                or len(bytes.fromhex(observation["object"])) != {56: 20, 497: 16}[sample["opcode"]]
                or sha(bytes.fromhex(sample["payloadHex"])) != observation["payloadSha256"]):
                raise ValueError("Actor event payload mismatch")
            location = (sample["opcode"], sample["param"], sample["chunkId"], sample["blockOffset"], sample["time"])
            if location in event_by_location:
                raise ValueError("Ambiguous actor event location")
            event_by_location[location] = observation
        event_source = {"nativeSha256": sha(event_bytes), "corpusSha256": sha(corpus_bytes)}
    buckets = {}
    for observation in objects["observations"].values():
        if observation["opcode"] == 28:
            buckets.setdefault((observation["payloadSha256"], observation["param"]), []).append(observation)
    cases, skipped, admitted_sequences = [], {}, []
    identities = {i["entityId"]: i for i in missiles["eventIndex"]["identities"]}
    for record in missiles["records"]:
        bucket = buckets.get((record["payloadSha256"], record["contextId"]))
        if not bucket:
            raise ValueError("Unmatched actor replication payload/context")
        observation = bucket.pop(0)
        if not supported(record["behaviorSpecs"]):
            key = "unprepared-spec" if record["behaviorSpecs"] is None else ",".join(s["__type"] for s in record["behaviorSpecs"])
            skipped[key] = skipped.get(key, 0) + 1
            continue
        if observation["status"] != "complete":
            raise ValueError("Incomplete native actor packet")
        admitted_sequences.append(record["sequence"])
        operations = []
        identity = identities[record["entityId"]]
        order = lambda event: (event["time"], event["sequence"])
        next_records = [r for r in identity["replications"] if order(r) > order(record)]
        until = min(map(order, next_records)) if next_records else (float("inf"), float("inf"))
        for event in identity["events"]:
            if event["opcode"] not in [56, 497] or not order(record) < order(event) < until:
                continue
            location = (event["opcode"], event["entityId"], event["chunkId"], event["blockOffset"], event["time"])
            if location not in event_by_location:
                raise ValueError("Bound event lacks original native packet")
            original = event_by_location[location]
            operation = {"type": "phase-notification" if event["opcode"] == 56 else "stop-notification",
                "time": event["time"], "sequence": event["sequence"], "payloadSha256": original["payloadSha256"]}
            if event["opcode"] == 56:
                operation["target"] = event["target"]
            operations.append((operation, bytes.fromhex(original["object"])))
        cases.append(run_case({"sequence": record["sequence"], "payloadSha256": record["payloadSha256"],
            "entityId": record["entityId"], "behaviorSpecs": record["behaviorSpecs"],
            "pendingChildren": record["pendingChildren"], "replicationPhase": record["replicationPhase"]},
            bytes.fromhex(observation["object"]), operations, "recorded-packets-notification-only-probe-not-runtime-trajectory"))
    configurations = [[], [{"__type": "CastOnHit"}], [{"__type": "CastOnHit", "RollForCriticalHitResult": True}]]
    configurations += [[{"__type": "DestroyOnMovementComplete", "mDelay": delay,
        "RenderParticlesAfterDestroy": render}] for delay in [-1, 0, 2, 5, 255, 256] for render in [False, True]]
    configurations += [[{"__type": "DestroyOnMovementComplete", "mDelay": 0},
        {"__type": "DestroyOnMovementComplete", "mDelay": 2, "RenderParticlesAfterDestroy": False}]]
    diagnostics = []
    for specs in configurations:
        for pending in [0, 2]:
            for phase in [0, 3, 255]:
                raw = bytearray(632)
                raw[0x210:0x211] = field_encode("missilePendingChildren", pending)
                raw[0x25c:0x25d] = field_encode("missileReplicationPhase", phase)
                operations = []
                for operation in [{"type": "phase-notification", "target": 2},
                    {"type": "release-child-gate"}, {"type": "release-child-gate"},
                    *[{"type": "post-movement-fragment", "arrived": value} for value in [True, True, False, True]],
                    {"type": "phase-notification", "target": 255},
                    {"type": "post-movement-fragment", "arrived": True},
                    {"type": "stop-notification"}, {"type": "stop-notification"}]:
                    event_raw = None
                    if operation["type"] == "phase-notification":
                        event_raw = bytearray(20)
                        event_raw[16:17] = field_encode("missilePhaseTarget", operation["target"])
                    operations.append((operation, bytes(event_raw) if event_raw is not None else None))
                diagnostics.append(run_case({"behaviorSpecs": specs, "pendingChildren": pending, "replicationPhase": phase},
                    bytes(raw), operations, "controlled-function-branch-probe-not-observed-gameplay"))
    result = {"schema": 1, "build": missiles["build"], "protocol": missiles["protocol"],
        "decoderImageSha256": profile["decoderImageSha256"], "actorDefinitionSha256": sha(definition_bytes),
        "fieldCodecsSha256": profile["fieldCodecsSha256"], "missileInputsSha256": sha(missile_bytes),
        "nativeObjectsSha256": sha(object_bytes), "eventSources": event_source,
        "cases": cases, "diagnostics": diagnostics, "admittedSequences": admitted_sequences, "skipped": skipped,
        "services": {"calls": service_counts, "memory": "Bounded owned allocator/free/copy; original component factories and vectors execute",
            "presentation": "Stop callback observed and counted, not a rendered backend", "children": "No child objects/registry; child phase-gate tail probed separately"},
        "scope": "Original phase/replication/stop and two component phase/frame callback paths on owned actors. Recorded notification probes omit intervening movement phases; diagnostic sequences are controlled function inputs, not gameplay or lifecycle/render fidelity"}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"records": len(cases), "recordedOperations": sum(len(c["operations"]) for c in cases),
        "diagnostics": len(diagnostics), "diagnosticOperations": sum(len(c["operations"]) for c in diagnostics), "skipped": skipped}))


if __name__ == "__main__":
    main()
