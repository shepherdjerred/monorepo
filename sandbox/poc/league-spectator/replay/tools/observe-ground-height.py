"""Execute original navgrid loading, ground queries and initial missile targets.

The loader runs only through the height-array read. Owned stream, allocator and
memset adapters replace host services; collision initialization is not executed.
The original wrapper, scalar sampler, cell comparison and admitted target
initialization then run on that grid. Cast-range projection and endpoints that
require an undecoded facing vector are deferred explicitly.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct

import unicorn
from unicorn import x86_const as reg


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "scene", "navgrid", "semantics", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--missiles", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    scene_bytes = (args.scene / "manifest.json").read_bytes()
    manifest = json.loads(scene_bytes)
    nav = args.navgrid.read_bytes()
    heights = (args.scene / "heights.bin").read_bytes()
    semantics_bytes = args.semantics.read_bytes()
    semantics = json.loads(semantics_bytes)
    grid = manifest["map"]["heightGrid"]
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(image) != profile["decoderImageSha256"]
        or manifest["build"] != profile["clientVersion"]
        or manifest["protocol"] != profile["protocolDigest"]
        or semantics["build"] != manifest["build"]
        or semantics["protocol"] != manifest["protocol"]
        or sha(nav) != grid["sourceSha256"]):
        raise ValueError("Ground-height inspection package mismatch")
    if nav[:3] != b"\x07\x01\x00":
        raise ValueError("Unsupported navigation grid")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    scratch, scratch_size = 0x10000000, 0x4000000
    engine.mem_map(scratch, scratch_size)
    stream, vtable, runtime, manager = 0x10002000, 0x10003000, 0x10004000, 0x10005000
    stop, stack, output = 0x10000000, 0x10010000, 0x10011000
    read_fn, tell_fn, seek_fn = 0x10000100, 0x10000110, 0x10000120
    for address in [read_fn, tell_fn, seek_fn]:
        engine.mem_write(address, b"\xc3")
    engine.mem_write(stream, struct.pack("<Q", vtable))
    for offset, address in [(0x10, read_fn), (0x28, tell_fn), (0x30, seek_fn)]:
        engine.mem_write(vtable + offset, struct.pack("<Q", address))
    cursor, heap, reads, allocations = 0, 0x11000000, 0, 0

    def return_from_host(value):
        rsp = engine.reg_read(reg.UC_X86_REG_RSP)
        address = struct.unpack("<Q", bytes(engine.mem_read(rsp, 8)))[0]
        engine.reg_write(reg.UC_X86_REG_RAX, value)
        engine.reg_write(reg.UC_X86_REG_RSP, rsp + 8)
        engine.reg_write(reg.UC_X86_REG_RIP, address)

    def host_adapter(uc, address, size, user):
        nonlocal cursor, heap, reads, allocations
        if address == read_fn:
            count, dest = uc.reg_read(reg.UC_X86_REG_RDX), uc.reg_read(reg.UC_X86_REG_RSI)
            if uc.reg_read(reg.UC_X86_REG_RDI) != stream or cursor + count > len(nav):
                raise ValueError("Native navgrid stream read outside source")
            if count:
                uc.mem_write(dest, nav[cursor:cursor + count])
            cursor += count
            reads += 1
            uc.reg_write(reg.UC_X86_REG_RAX, count)
        elif address == tell_fn:
            uc.reg_write(reg.UC_X86_REG_RAX, cursor)
        elif address == seek_fn:
            cursor = uc.reg_read(reg.UC_X86_REG_RSI)
            if cursor > len(nav):
                raise ValueError("Native navgrid seek outside source")
        elif address == base + 0x14766c0:
            count = uc.reg_read(reg.UC_X86_REG_RDI)
            allocation = heap
            heap += (count + 15) & ~15
            if heap > scratch + scratch_size:
                raise ValueError("Native navgrid allocation limit")
            allocations += 1
            return_from_host(allocation)
        elif address == base + 0x1499ce0:
            dest, value, count = (uc.reg_read(r) for r in
                [reg.UC_X86_REG_RDI, reg.UC_X86_REG_RSI, reg.UC_X86_REG_RDX])
            if not scratch <= dest <= dest + count <= scratch + scratch_size:
                raise ValueError("Native navgrid memset outside owned scratch")
            if count:
                uc.mem_write(dest, bytes([value & 255]) * count)
            return_from_host(dest)

    for address in [read_fn, tell_fn, seek_fn, base + 0x14766c0, base + 0x1499ce0]:
        engine.hook_add(unicorn.UC_HOOK_CODE, host_adapter, begin=address, end=address)
    engine.mem_write(stack, struct.pack("<Q", stop))
    engine.reg_write(reg.UC_X86_REG_RSP, stack)
    engine.reg_write(reg.UC_X86_REG_RDI, runtime)
    engine.reg_write(reg.UC_X86_REG_RSI, stream)
    engine.emu_start(base + 0x16bd650, base + 0x16bdcfd, count=20000000)
    if engine.reg_read(reg.UC_X86_REG_RIP) != base + 0x16bdcfd:
        raise ValueError("Native navgrid loader instruction limit")
    runtime_bytes = bytes(engine.mem_read(runtime, 0x110))
    dimensions = struct.unpack_from("<IIff", runtime_bytes, 0x100)
    minimum = struct.unpack_from("<fff", runtime_bytes, 0xbc)
    maximum = struct.unpack_from("<fff", runtime_bytes, 0xc8)
    pointer = struct.unpack_from("<Q", runtime_bytes, 0xf8)[0]
    loaded_heights = bytes(engine.mem_read(pointer, dimensions[0] * dimensions[1] * 4))
    if (list(dimensions) != [grid["x"], grid["z"], *grid["step"]]
        or list(minimum) != manifest["map"]["min"]
        or list(maximum) != manifest["map"]["max"]
        or loaded_heights != heights):
        raise ValueError("Native navgrid load disagrees with prepared scene")
    loader_cursor = cursor
    engine.mem_write(base + 0x246c948, struct.pack("<Q", manager))
    engine.mem_write(manager + 8, struct.pack("<Q", runtime))
    engine.reg_write(reg.UC_X86_REG_R12, runtime)
    engine.emu_start(base + 0x16b6f6c, base + 0x16b6fc9, count=1000)
    if engine.reg_read(reg.UC_X86_REG_RIP) != base + 0x16b6fc9:
        raise ValueError("Native movement-origin initializer instruction limit")
    origin = [struct.unpack("<h", bytes(engine.mem_read(base + address, 2)))[0]
              for address in [0x16b6fb7 + 0xe82fcb, 0x16b6fc9 + 0xe82fbb]]
    if origin != manifest["map"]["movementOrigin"]:
        raise ValueError("Native movement origin differs from prepared scene")
    initial = engine.context_save()
    f = lambda value: struct.unpack("<f", struct.pack("<f", value))[0]
    cases, unique = [], set()

    def add(kind, x, z):
        x, z = f(x), f(z)
        key = struct.pack("<ff", x, z)
        if key in unique:
            return
        unique.add(key)
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.mem_write(output, b"\xa5" * 4)
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        engine.reg_write(reg.UC_X86_REG_RDI, output)
        engine.reg_write(reg.UC_X86_REG_XMM0, int.from_bytes(key[:4], "little"))
        engine.reg_write(reg.UC_X86_REG_XMM1, int.from_bytes(key[4:], "little"))
        engine.emu_start(base + 0x16ba3b0, stop, count=1000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError("Native height-query instruction limit")
        inside = bool(engine.reg_read(reg.UC_X86_REG_EAX) & 255)
        raw = bytes(engine.mem_read(output, 4))
        if not inside and raw != b"\xa5" * 4:
            raise ValueError("Outside-map query unexpectedly wrote output")
        cases.append({"kind": kind, "x": x, "z": z, "inside": inside,
                      "heightBits": int.from_bytes(raw, "little") if inside else None})

    for hero in semantics["heroes"]:
        add("hero-creation", hero["creationPosition"][0], hero["creationPosition"][2])
    for record in semantics["movement"]:
        for x, z in record["encodedWaypoints"]:
            add("movement-anchor", x * 2 + manifest["map"]["movementOrigin"][0],
                z * 2 + manifest["map"]["movementOrigin"][1])
    for record in [*semantics["missiles"], *semantics["casts"]]:
        cast = record.get("cast", record)
        for name in ["sourcePosition", "targetPosition"]:
            add(name, cast[name][0], cast[name][2])
    for x in [minimum[0], maximum[0], f(minimum[0] - 1), f(maximum[0] + 1)]:
        for z in [minimum[2], maximum[2], f(minimum[2] - 1), f(maximum[2] + 1)]:
            add("map-boundary", x, z)
    rng = random.Random(16218298620)
    for _ in range(4096):
        add("grid-node", f(minimum[0] + rng.randrange(grid["x"]) * grid["step"][0]),
            f(minimum[2] + rng.randrange(grid["z"]) * grid["step"][1]))
        add("fractional-position", rng.uniform(minimum[0] - 20, maximum[0] + 20),
            rng.uniform(minimum[2] - 20, maximum[2] + 20))
    first_at, second_at = 0x10012000, 0x10013000
    cell_cases = []

    def same_cell(first, second):
        first, second = list(map(f, first)), list(map(f, second))
        engine.context_restore(initial)
        engine.mem_write(first_at, struct.pack("<fff", *first))
        engine.mem_write(second_at, struct.pack("<fff", *second))
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        engine.reg_write(reg.UC_X86_REG_RDI, first_at)
        engine.reg_write(reg.UC_X86_REG_RSI, second_at)
        engine.emu_start(base + 0x16b3570, stop, count=1000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError("Native movement-cell query instruction limit")
        return bool(engine.reg_read(reg.UC_X86_REG_EAX) & 255)

    recorded = [*semantics["missiles"], *semantics["casts"]]
    for record in recorded:
        cast = record.get("cast", record)
        a, b = cast["targetPosition"], cast["sourcePosition"]
        cell_cases.append({"kind": "recorded-cast", "key": str(record["sequence"]),
                           "first": a, "second": b, "same": same_cell(a, b)})
    values = [-1e20, -65538, -65536, -65534, -2.0001, -2, -1.9999,
              -0.001, 0, 0.001, 1.9999, 2, 2.0001, 65534, 65536, 65538, 1e20]
    for lane, center in [(0, origin[0]), (2, origin[1])]:
        for a in values:
            for b in values:
                first = [origin[0], 0, origin[1]]
                second = first.copy()
                first[lane], second[lane] = f(center + a), f(center + b)
                cell_cases.append({"kind": "quantization-boundary", "first": first,
                                   "second": second, "same": same_cell(first, second)})
    target_cases, deferred_targets = [], []
    missile_bytes = args.missiles.read_bytes() if args.missiles else None
    if missile_bytes:
        analysis = json.loads(missile_bytes)
        originals = {r["sequence"]: r for r in semantics["missiles"]}
        if (analysis["build"] != manifest["build"] or analysis["protocol"] != manifest["protocol"]
            or analysis["replaySha256"] != semantics["replaySha256"]
            or analysis["fieldCodecsSha256"] != profile["fieldCodecsSha256"]
            or len(analysis["records"]) != len(originals)):
            raise ValueError("Missile-target inputs differ from prepared replay")
        normalized, target_at, helper, spec, motion_at = (
            0x10014000, 0x10015000, 0x10016000, 0x10017000, 0x10018000)
        for record in analysis["records"]:
            original = originals[record["sequence"]]
            if (record["cast"] != original["cast"] or record["time"] != original["time"]
                or record["entityId"] != original["entityId"]):
                raise ValueError("Missile-target fields differ from decoded source")
            settings = record["settings"]
            if not settings:
                continue
            cast = record["cast"]
            if settings["mProjectTargetToCastRange"]:
                deferred_targets.append({"sequence": record["sequence"], "reason": "cast-range-projection"})
                continue
            if same_cell(cast["targetPosition"], cast["sourcePosition"]):
                deferred_targets.append({"sequence": record["sequence"], "reason": "facing-vector"})
                continue
            engine.context_restore(initial)
            engine.mem_write(normalized, bytes(0x180))
            engine.mem_write(normalized + 0xc8, struct.pack("<fff", *cast["sourcePosition"]))
            engine.mem_write(target_at, struct.pack("<fff", *cast["targetPosition"]))
            engine.mem_write(helper, bytes([settings["mInferDirectionFromFacingIfNeeded"],
                settings["mProjectTargetToCastRange"], settings["AddBonusAttackRangeToCastRange"]]))
            engine.mem_write(stack, struct.pack("<Q", stop))
            engine.reg_write(reg.UC_X86_REG_RSP, stack)
            engine.reg_write(reg.UC_X86_REG_RDI, helper)
            engine.reg_write(reg.UC_X86_REG_RSI, target_at)
            engine.reg_write(reg.UC_X86_REG_RDX, normalized)
            engine.emu_start(base + 0x873e70, stop, count=2000)
            if engine.reg_read(reg.UC_X86_REG_RIP) != stop:
                raise ValueError("Native missile target initializer instruction limit")
            initial_target = bytes(engine.mem_read(target_at, 12))
            engine.mem_write(motion_at + 0x7c, initial_target)
            engine.mem_write(spec + 0x10, struct.pack("<f", settings["mOffsetInitialTargetHeight"]))
            engine.reg_write(reg.UC_X86_REG_RBX, motion_at)
            engine.reg_write(reg.UC_X86_REG_R15, spec)
            engine.emu_start(base + 0x88a155, base + 0x88a16b, count=100)
            if engine.reg_read(reg.UC_X86_REG_RIP) != base + 0x88a16b:
                raise ValueError("Native missile target-height addition instruction limit")
            target_cases.append({"sequence": record["sequence"],
                "source": cast["sourcePosition"], "target": cast["targetPosition"],
                "settings": settings, "positionBits": list(struct.unpack("<III",
                    bytes(engine.mem_read(motion_at + 0x7c, 12))))})
    if bytes(engine.mem_read(pointer, len(heights))) != heights:
        raise ValueError("Ground queries mutated height samples")
    blocks = [(0x16bd650, 0x16bdcfd), (0x16ba3b0, 0x16ba41e), (0x16bb220, 0x16bb3b0),
              (0x16b6f6c, 0x16b6fc9), (0x16b3570, 0x16b3610),
              (0x873e70, 0x874080), (0x88a155, 0x88a16b)]
    result = {"schema": 1, "build": manifest["build"], "protocol": manifest["protocol"],
              "decoderImageSha256": profile["decoderImageSha256"],
              "sceneManifestSha256": sha(scene_bytes), "navgridSha256": sha(nav),
              "heightsSha256": sha(heights), "semanticsSha256": sha(semantics_bytes),
              "missileInputsSha256": sha(missile_bytes) if missile_bytes else None,
              "movementOrigin": origin, "cellCases": cell_cases,
              "targetCases": target_cases, "deferredTargets": deferred_targets,
              "loader": {"entryRva": 0x16bd650, "stopRva": 0x16bdcfd,
                         "cursor": loader_cursor, "reads": reads, "allocations": allocations,
                         "dimensions": list(dimensions), "heightSamples": len(heights) // 4,
                         "preparedSamplesMatch": True},
              "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(image[a:b])} for a, b in blocks],
              "scope": "Original partial loader, ground query, movement-cell comparison and nonprojected/nondegenerate initial missile targets; owned stream/allocation/memset adapters, no collision initialization, full trajectories, game runtime, browser UI or A/V validation",
              "cases": cases}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"heightSamples": len(heights) // 4, "cases": len(cases),
                      "outsideMap": sum(not c["inside"] for c in cases), "loaderCursor": loader_cursor,
                      "cellCases": len(cell_cases), "targetCases": len(target_cases),
                      "deferredTargets": len(deferred_targets)}))


if __name__ == "__main__":
    main()
