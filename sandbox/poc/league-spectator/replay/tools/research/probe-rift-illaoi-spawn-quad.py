"""Sample the archived arbitrary-quad writer with Illaoi's authored spawn decal.

The detached recorded origin feeds an identity attachment. The navigation pass
and the stop handler's mutation of a live effect are separately scoped.
"""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import unicorn
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image


def checked_json(path, expected):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError(f"Unreviewed local input {path}")
    return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    if not __debug__:
        parser.error("Run the native probe with Python assertions enabled")
    for name in ("archive", "creation", "stops", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--creation-sha256", required=True)
    parser.add_argument("--stops-sha256", required=True)
    parser.add_argument("--cadence", type=int, choices=(60, 120), default=60)
    parser.add_argument("--control", choices=("zero-anchor", "no-rotation-curve", "alternate-rng"))
    args = parser.parse_args()
    if not args.output.parent.resolve().is_relative_to(Path(".cache").resolve()) or args.output.exists():
        raise ValueError("Expected a fresh private .cache output")
    binary = args.archive.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    image = read_replication_image(binary, CURRENT_BUILD)
    receipt = checked_json(args.creation, args.creation_sha256)
    stop_requests = checked_json(args.stops, args.stops_sha256)
    if (
        receipt["executableSha256"] != digest
        or stop_requests["executableSha256"] != digest
        or stop_requests["replaySha256"] != receipt["replaySha256"]
        or stop_requests["protocol"] != receipt["protocol"]
        or receipt["protocol"] != "8bbfcd5af2bc92db"
        or receipt["build"] != CURRENT_BUILD
        or stop_requests["build"] != CURRENT_BUILD
        or stop_requests["kind"] != "recorded-particle-stop-requests"
        or stop_requests["opcode"] != 1164
    ):
        raise ValueError("Incompatible archived creation and stop receipts")
    family = next(row for row in receipt["families"] if row["key"] == "71981a32")
    emitter = family["emitters"][1]
    assert emitter["name"] == "Ground_SLOW2"
    fields = emitter["fields"]
    assert "3bf0b4ed" not in fields
    assert fields["007b14f6"]["classHash"] == "4beb81fd"
    assert "40c351da" not in json.dumps(fields)

    def constant(key):
        return fields[key]["fields"]["b4b427aa"]["value"]

    def vec(value):
        return [value[axis] for axis in "XYZW" if axis in value]

    authored = {
        "rate": constant("ae839c67"),
        "lifetime": fields["5212abee"]["value"]["value"],
        "particleLifetime": None,
        "particleLinger": None,
        "bindWeight": None,
        "color": [1, 1, 1, 1],
        "birthColor": vec(constant("83cdeaa1")),
        "EmitterPosition": [0, 0, 0],
        "birthRotation0": vec(constant("5932ff9c")),
        "birthScale0": vec(constant("f0eb7084")),
        "initialRotationalVelocity": vec(constant("1d779e6a")),
        "rotation0": vec(constant("712b01bd")),
        "blendMode": fields["fa784eab"]["value"],
    }
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))

    stop = 0x10000000
    vm.mem_map(stop, 0x10000)
    stack = stop + 0xF008
    definition, actor, link, system, quality = (stop + offset for offset in range(0x1000, 0x6000, 0x1000))

    def put(address, format_string, *values):
        vm.mem_write(address, struct.pack("<" + format_string, *values))

    def host_boundary(engine, address, _size, _data):
        nonlocal heap
        rdi = engine.reg_read(reg.UC_X86_REG_RDI)
        rsi = engine.reg_read(reg.UC_X86_REG_RSI)
        rva = address - image.base
        if rva in (0x14A0300, 0x14A2030, 0x14C5B20):
            if not 0 < rdi <= 0x400 or heap + rdi > stop + 0xA000:
                raise ValueError("Original emitter allocation exceeds owned arena")
            engine.reg_write(reg.UC_X86_REG_RAX, heap)
            heap += (rdi + 15) & ~15
        elif rva == 0x14C5B80:
            if rdi and not stop + 0x8000 <= rdi < heap:
                raise ValueError("Unexpected release outside the owned pool")
        elif rva == 0x2051310:
            source = bytes(engine.mem_read(rdi, 128))
            engine.reg_write(reg.UC_X86_REG_RAX, source.index(0))
        elif rva == 0x2050F6E:
            size = engine.reg_read(reg.UC_X86_REG_RDX)
            if size > 128 or not (stop + 0x8000 <= rdi <= heap - size or stack - 0x1000 <= rdi <= stack - size):
                raise ValueError("Original emitter copy outside owned memory")
            engine.mem_write(rdi, bytes(engine.mem_read(rsi, size)))
            engine.reg_write(reg.UC_X86_REG_RAX, rdi)
        elif rva == 0x2050B90:
            bits = engine.reg_read(reg.UC_X86_REG_XMM0) & 0xFFFFFFFF
            (angle,) = struct.unpack("<f", struct.pack("<I", bits))
            engine.reg_write(
                reg.UC_X86_REG_XMM0,
                int.from_bytes(
                    struct.pack("<ff", math.sin(angle), math.cos(angle)),
                    "little",
                ),
            )
        elif rva == 0x14BC630:
            rng_samples.append(supplied_random)
            engine.reg_write(
                reg.UC_X86_REG_XMM0,
                struct.unpack(
                    "<I",
                    struct.pack("<f", supplied_random),
                )[0],
            )
        elif rva == 0x2050D8E:

            def argument(register):
                bits = engine.reg_read(register) & 0xFFFFFFFF
                return struct.unpack("<f", struct.pack("<I", bits))[0]

            value = math.fmod(argument(reg.UC_X86_REG_XMM0), argument(reg.UC_X86_REG_XMM1))
            engine.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", value))[0])
        rsp = engine.reg_read(reg.UC_X86_REG_RSP)
        (target,) = struct.unpack("<Q", engine.mem_read(rsp, 8))
        engine.reg_write(reg.UC_X86_REG_RSP, rsp + 8)
        engine.reg_write(reg.UC_X86_REG_RIP, target)

    def call(entry, rdi, rsi=0, time=None, end=stop):
        put(stack, "Q", stop)
        vm.reg_write(reg.UC_X86_REG_RSP, stack)
        vm.reg_write(reg.UC_X86_REG_RDI, rdi)
        vm.reg_write(reg.UC_X86_REG_RSI, rsi)
        if time is not None:
            vm.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", time))[0])
        vm.emu_start(image.base + entry, end, count=30000)
        result = vm.reg_read(reg.UC_X86_REG_RIP)
        if result != end:
            raise ValueError(f"Native emitter {entry:#x} did not complete: {result - image.base:#x}")
        return vm.reg_read(reg.UC_X86_REG_RAX)

    # Class registrations 0x1727d37 and 0x17e5067 identify these in-place
    # constructors. The rate and single-particle bindings are in the same
    # registration at 0x1727d90 and 0x1727e22.
    heap = stop + 0x8000
    hooks = [
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
        for rva in (0x14A0300, 0x14A2030, 0x2051310, 0x2050F6E)
    ]
    call(0x14D501F, definition, end=image.base + 0x14D523E)
    call(0x17BDC20, definition)
    for hook in hooks:
        vm.hook_del(hook)
    # The emitter constructor initially places CameraQuad in this link.
    # The class registration for 4beb81fd provides the original placement
    # constructor at 0x17d6740 for the authored ArbitraryQuad.
    primitive = stop + 0x7A00
    call(0x17D6740, primitive)
    assert vm.mem_read(primitive + 8, 1) == b"\x01"
    for field, at in (("particleLifetime", 0xF8), ("particleLinger", 0x118), ("bindWeight", 0x3A0)):
        (authored[field],) = struct.unpack("<f", vm.mem_read(definition + at, 4))
    (period_bits,) = struct.unpack("<I", vm.mem_read(definition + 0x224, 4))
    if period_bits != 0x7F7FFFFF:
        raise ValueError("Unexpected native emitter period")

    put(definition + 0x1F0, "f", authored["rate"])
    (flags,) = struct.unpack("<I", vm.mem_read(definition + 0x2D0, 4))
    put(definition + 0x2D0, "I", flags | 0x100000)
    put(definition + 0x60, "Q", primitive)
    put(actor, "QQ", system, link)
    put(link + 0x10, "Q", definition)
    put(image.base + 0x24E8660, "Q", quality)
    put(quality + 0x284, "6f", *([1] * 6))

    resource, resource_settings, pool, attachment = (stop + offset for offset in (0x7100, 0x7300, 0x7500, 0x7700))
    put(link + 8, "Q", resource)
    put(resource + 0x38, "Q", resource_settings)
    put(link + 0x1C, "i", -1)
    put(link + 0x30, "i", -1)
    put(link + 0xE0, "ii", -1, -1)
    put(actor + 0x20, "f", authored["lifetime"])
    put(actor + 0x38, "Q", attachment)
    put(actor + 0xA0, "Q", pool)
    # Owned empty pool and its emitter, enclosing actor, and resource links.
    put(pool + 0xD8, "QQ", link, actor)
    put(system + 0x1E8, "Q", resource)
    put(resource_settings + 0x38, "Q", pool + 0x100)
    call(0x14B4E00, system + 0x248)
    [event] = family["events"]
    assert event["descriptor"]["flags"] == 32 and event["descriptor"]["scaleRate"] == [1, 1]
    root_pos, secondary, direction = event["descriptor"]["positions"]
    assert all(value == 0 for value in (*secondary, *direction))
    if args.control != "zero-anchor":
        put(system + 0x278, "3f", *root_pos)
        # The two recorded-anchor slots agree for the detached static effect.
        put(system + 0xFC, "3f", *root_pos)
        put(system + 0x108, "3f", *root_pos)
    # Typed registrations bind these constants at 0x1727dc1 through 0x1728753.
    put(definition + 0x240, "3f", *authored["EmitterPosition"])
    put(definition + 0xF8, "f", authored["particleLifetime"])
    put(definition + 0x118, "f", authored["particleLinger"])
    put(definition + 0x108, "f", authored["lifetime"])
    put(definition + 0x3A0, "f", authored["bindWeight"])
    put(definition + 0x150, "4f", *authored["birthColor"])
    put(definition + 0x70, "hB", fields["7b7a7318"]["value"], fields["6563bee8"]["value"])
    put(definition + 0x77, "B", fields["b99310f4"]["value"])
    put(definition + 0x388, "4f", *authored["color"])
    put(definition + 0x3D0, "3f", *authored["birthRotation0"])
    put(definition + 0x3E8, "3f", *authored["birthScale0"])
    put(definition + 0x400, "3f", *authored["initialRotationalVelocity"])
    put(definition + 0x438, "3f", *authored["rotation0"])
    put(definition + 0x14, "B", authored["blendMode"])
    assert all(fields[k]["value"] == 1 for k in ("3559e15b", "8d2e2474", "27d40903", "dddde180"))
    put(definition + 0x2D0, "I", flags | 0x100000 | 0x4000 | 0x1000 | 0x100 | 8)
    assert not any(vm.mem_read(definition + 0x238, 8))
    put(system + 0x150, "2f", 1, 1)
    put(system + 0x1B0, "8f", *([1] * 8))
    # The outer update copies this separate system alpha into its context.
    put(system + 0x1D0, "f", 1)

    def vector_curve(key, typed_property, curve, data):
        source = fields[key]["fields"]["bc037de7"]["fields"]
        times = [item["value"] for item in source["5d68eeb5"]["elements"]]
        values = [axis for item in source["34474c3b"]["elements"] for axis in vec(item["value"])]
        call(0x17AFEC0, curve)
        put(curve + 0x20, "QII", data, len(times), len(times))
        put(curve + 0x30, "QII", data + 0x20, len(times), len(times))
        put(data, f"{len(times)}f", *times)
        put(data + 0x20, f"{len(values)}f", *values)
        put(definition + typed_property + 0x10, "Q", curve)

    vector_curve("d4e17a53", 0x420, stop + 0xD000, stop + 0xD100)
    if args.control != "no-rotation-curve":
        vector_curve("712b01bd", 0x438, stop + 0xD200, stop + 0xD300)
    color_curve, curves_data = [stop + n for n in (0xC000, 0xC200)]
    call(0x17B0430, color_curve)
    put(definition + 0x398, "Q", color_curve)
    typed = fields["3d7e6258"]["fields"]["bc037de7"]["fields"]
    times = [x["value"] for x in typed["5d68eeb5"]["elements"]]
    colors = [c for x in typed["34474c3b"]["elements"] for c in vec(x["value"])]
    n = len(times)
    put(color_curve + 0x28, "QII", curves_data, n, n)
    put(color_curve + 0x38, "QII", curves_data + 0x20, n, n)
    put(curves_data, f"{n}f", *times)
    put(curves_data + 0x20, f"{n * 4}f", *colors)

    # The original render-system constructor initializes the opacity and base
    # UV factors together. Run its member writes on a separate object so the
    # detached placement supplied to this probe keeps its own transform.
    native_init_shadow = stop + 0x6000
    native_init_frame = stop + 0x6400
    native_init_position = stop + 0x6500
    put(native_init_position, "3f", *root_pos)
    for register, value in (
        (reg.UC_X86_REG_RBX, native_init_shadow),
        (reg.UC_X86_REG_RBP, native_init_frame),
        (reg.UC_X86_REG_R12, native_init_position),
        (reg.UC_X86_REG_R15, resource),
    ):
        vm.reg_write(register, value)
    call(0x178EC57, native_init_shadow, end=image.base + 0x178ED28)
    native_modulators = bytes(vm.mem_read(native_init_shadow + 0x1F0, 8))
    assert native_modulators.hex() == "0000803f0000803f"
    vm.mem_write(system + 0x1F0, native_modulators)
    base_uv_predicate = bool(vm.mem_read(link + 0xE8, 1)[0])
    assert not base_uv_predicate

    writer = struct.unpack("<Q", vm.mem_read(struct.unpack("<Q", vm.mem_read(primitive, 8))[0] + 0x28, 8))[0]
    view, draw, geometry, indices, vertices = [stop + n for n in (0xA000, 0xA100, 0xA200, 0xA300, 0xA400)]
    put(image.base + 0x24DC310, "Q", view + 0x88)

    def snapshot():
        put(geometry, "5Q", indices, vertices, draw, actor, view)
        put(view, "3f", 0, 0, 1000)
        put(view + 0x24, "3f", 0, 0, -1)
        view_row = stop + 0xE000
        put(quality + 0x360, "Q", view_row)
        put(view_row, "Q", view)
        put(view_row + 0x170, "6f", 1, 0, 0, 0, 1, 0)
        call(writer - image.base, primitive, geometry)
        index_end, vertex_end = struct.unpack("<2Q", vm.mem_read(geometry, 16))
        if index_end == indices:
            return None
        assert vertex_end - vertices == 8 * 28
        vertex_bytes = bytes(vm.mem_read(vertices, vertex_end - vertices))
        expected_uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        base_uvs = [struct.unpack_from("<2e", vertex_bytes, offset + 16) for offset in range(0, len(vertex_bytes), 28)]
        assert base_uvs == expected_uvs * 2
        return {
            "indices": index_end - indices,
            "indexBytes": bytes(vm.mem_read(indices, index_end - indices)).hex(),
            "vertices": vertex_end - vertices,
            "vertexBytes": vertex_bytes.hex(),
        }

    previous_clock_marker = bytes(image.image[0x2140974:0x2140978])

    def capture_birth(engine, _address, _size, _data):
        clock_context = engine.reg_read(reg.UC_X86_REG_RSI)
        position = struct.unpack("<3f", engine.mem_read(clock_context, 12))
        (clock,) = struct.unpack("<f", engine.mem_read(clock_context + 0x18, 4))
        count = engine.reg_read(reg.UC_X86_REG_EDX)
        updates.append(
            {
                "entry": 0x1786280,
                "birthEntry": 0x1786E00,
                "suppliedElapsedSeconds": 0,
                "birthClockSeconds": clock,
                "birthCount": count,
                "emitterPositionInput": position,
            }
        )

    birth_entry = image.base + 0x1786E00
    insertion_entry = image.base + 0x1789DF0
    vm.hook_add(unicorn.UC_HOOK_CODE, capture_birth, begin=birth_entry, end=birth_entry)

    def capture_transform(engine, address, _size, _data):
        rva = address - image.base
        if rva == 0x1787D28:
            source = engine.reg_read(reg.UC_X86_REG_R14)
            transform.append(
                {
                    "rva": rva,
                    "r14IsSystem": source == system,
                    "read": struct.unpack("<6f", engine.mem_read(source + 0xFC, 24)),
                }
            )
        else:
            source = engine.reg_read(reg.UC_X86_REG_RSI)
            transform.append({"rva": rva, "origin": struct.unpack("<3f", engine.mem_read(source, 12))})

    for rva in (0x1787D28, 0x1787D56):
        vm.hook_add(unicorn.UC_HOOK_CODE, capture_transform, begin=image.base + rva, end=image.base + rva)
    for rva in (0x2050D8E, 0x2050B90, 0x14BC630, 0x14C5B20, 0x14C5B80):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)

    def capture_insertion(_engine, _address, _size, _data):
        data = vm.mem_read(vm.reg_read(reg.UC_X86_REG_RSI), 0xDC)
        inserts.append(
            {
                "position": struct.unpack_from("<3f", data, 0x50),
                "scale": struct.unpack_from("<3f", data, 0x68),
                "lifetime": struct.unpack_from("<f", data, 0xCC)[0],
                "birthClock": currentTime,
            }
        )

    vm.hook_add(unicorn.UC_HOOK_CODE, capture_insertion, begin=insertion_entry, end=insertion_entry)
    supplied_random = 0.875 if args.control == "alternate-rng" else 0.125
    rng_samples, updates, inserts, timeline, transform = [], [], [], [], []
    vm.mem_write(actor + 0x24, previous_clock_marker)
    put(actor + 0x18, "B", 0)
    [stop_row] = [
        row
        for row in stop_requests["events"]
        if row["target"] == event["handle"] and row["sequence"] > event["sequence"]
    ]
    assert stop_row["route"] == "direct-stop"
    stop_age = stop_row["stamp"] - event["stamp"]
    assert 0 < stop_age < authored["particleLifetime"]
    ages = [tick / args.cadence for tick in range(math.ceil(stop_age * args.cadence))]
    ages.append(stop_age)
    stop_control = None
    for currentTime in ages:
        call(0x1786280, actor, time=currentTime)
        (count,) = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))
        timeline.append([currentTime, count, snapshot() if count else None])
        if currentTime == stop_age:
            entity = stop + 0xD700
            # The packet entity points to the effect wrapper. The writer's
            # internal render system is a different object at wrapper + 0x28.
            wrapper = stop + 0xD900
            put(wrapper + 0x28, "Q", system)
            put(entity + 0x188, "Q", wrapper)
            direct_stop = struct.unpack_from("<Q", image.image, 0x238CF98 + 0x210)[0] - image.base
            assert direct_stop == 0x378780
            call(direct_stop, entity)
            assert vm.mem_read(entity + 0x188, 8) == bytes(8)
            assert vm.mem_read(wrapper + 0x19, 2) == b"\x08\x08"
            assert vm.mem_read(system + 0x1F0, 8) == native_modulators
            stop_control = {
                "age": stop_age,
                "request": stop_row,
                "nativeVirtualRva": direct_stop,
                "nativeWrapperStopBytes": "0808",
                "renderSystemUvUnchanged": True,
                "entitySystemPointerCleared": True,
                "externalCallbackSupplied": False,
                "residentPoolCountAfterStop": struct.unpack("<I", vm.mem_read(pool + 0x10, 4))[0],
            }
            break
    assert len(inserts) == 2 and len(updates) == 1
    assert stop_control is not None
    assert all(
        count == len(inserts) and geometry["indices"] == 12 * count and geometry["vertices"] == 112 * count
        for _, count, geometry in timeline
    ), timeline
    data = {
        "schema": 1,
        "kind": "offline-illaoi-spawn-quad",
        "build": CURRENT_BUILD,
        "replaySha256": receipt["replaySha256"],
        "protocol": receipt["protocol"],
        "creationSha256": args.creation_sha256,
        "stopsSha256": args.stops_sha256,
        "cadence": args.cadence,
        "control": args.control,
        "authored": authored,
        "executableSha256": digest,
        "resourceKey": family["key"],
        "component": emitter["name"],
        "pathHash": family["pathHash"],
        "sourceSha256": family["sourceSha256"],
        "writerRva": writer - image.base,
        "scope": {
            "recordedTranslation": True,
            "suppliedIdentityAttachment": True,
            "isolatedEffectStop": True,
            "postStopScheduler": False,
            "navigationContext": False,
            "shaderAndMaterial": False,
            "browserAppearance": False,
        },
        "worldOrigin": root_pos,
        "event": event,
        "updates": updates,
        "inserts": inserts,
        "rngCalls": len(rng_samples),
        "suppliedRngSample": supplied_random,
        "timeline": timeline,
        "transform": transform,
        "stopControl": stop_control,
        "uvControl": {
            "initializerStartRva": 0x178EC57,
            "initializerEndRva": 0x178ED28,
            "ownedRenderSystemOffset": 0x1F0,
            "nativeModulatorPairHex": native_modulators.hex(),
            "baseUvPredicate": base_uv_predicate,
        },
    }
    with args.output.open("xb") as handle:
        handle.write((json.dumps(data, separators=(",", ":")) + "\n").encode("utf-8"))
    print(f"Verified {len(timeline)} native frames through the recorded stop")


if __name__ == "__main__":
    main()
