"""Sample exact-build recorded Yasuo or Lee Sin CameraQuad emitters.

The replay handle seeds a repeatable sample of the original clock-seeded RNG.
The fixed random controls exercise the authored probability curves.
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


def lee_sin_authored(row):
    event, fields = row["event"], row["emitter"]["fields"]
    assert event["handle"] == 1073821521
    assert event["packetDescriptorControl"]["descriptor"]["scaleRate"] == [1, 1]
    assert fields["3d25b8ce"]["value"] == "flash"
    assert fields["42bd7f6b"]["value"] == 1  # isSingleParticle
    assert fields["3559e15b"]["value"] == 1  # isUniformScale

    def constant(key):
        value = fields[key]["fields"]["b4b427aa"]["value"]
        return list(value.values()) if isinstance(value, dict) else value

    return {
        "rate": constant("ae839c67"),
        "lifetime": fields["5212abee"]["value"]["value"],
        "EmitterPosition": [0, 0, 0],
        "particleLifetime": constant("2a552694"),
        "particleLinger": fields["2431d42c"]["value"]["value"],
        "bindWeight": constant("ca406316"),
        "birthRotation0": constant("5932ff9c"),
        "birthScale0": constant("f0eb7084"),
        "blendMode": fields["fa784eab"]["value"],
    }


def bind_lee_sin_curves(fields, stop, definition, scale, data, vm, call, put):
    shape, flex = stop + 0x16000, stop + 0x16100
    call(0x17C59D0, shape)
    call(0x17BE640, flex)
    assert fields["3bf0b4ed"]["fields"] == {}
    assert bytes(vm.mem_read(shape + 8, 12)) == bytes(12)
    assert bytes(vm.mem_read(flex, 0x30)) == bytes(0x30)
    put(definition + 0x238, "Q", shape)
    put(definition + 0x258, "Q", flex)
    flex_fields = fields["4ffce322"]["fields"]
    put(flex + 4, "f", flex_fields["95111b29"]["value"])
    put(flex + 0x10, "f", flex_fields["c0bf561e"]["value"])

    def bind_curve(key, curve, times_at, values_at, dimension, vector_offset, constructor, destination):
        native = fields[key]["fields"]["bc037de7"]["fields"]
        times = [item["value"] for item in native["5d68eeb5"]["elements"]]
        values = [axis for item in native["34474c3b"]["elements"] for axis in item["value"].values()]
        call(constructor, curve)
        put(curve + vector_offset, "QII", times_at, len(times), len(times))
        put(curve + vector_offset + 0x10, "QII", values_at, len(times), len(times))
        put(times_at, f"{len(times)}f", *times)
        put(values_at, f"{len(times) * dimension}f", *values)
        put(definition + destination, "Q", curve)

    bind_curve("d4e17a53", scale, data + 0x80, data + 0xA0, 3, 0x20, 0x17AFEC0, 0x430)
    bind_curve("3d7e6258", stop + 0xD000, data + 0x1C0, data + 0x1D0, 4, 0x28, 0x17B0430, 0x398)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("authored", type=Path)
    parser.add_argument("random_control", choices=("0.125", "0.875", "seeded"))
    parser.add_argument("handle", type=int, choices=(1073820923, 1073820924, 1073820962, 1073821375, 1073821521))
    parser.add_argument("--lee-bound-size", type=int, choices=(0, 65, 200))
    args = parser.parse_args()
    lee_sin = args.handle == 1073821521
    if lee_sin != (args.lee_bound_size is not None):
        parser.error("Supply an explicit controlled bound size only for Lee Sin handle 1073821521")
    if not __debug__:
        raise RuntimeError("Run this verification without Python optimizations")
    binary = args.executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    assert digest == "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
    image = read_replication_image(binary, CURRENT_BUILD)
    source = args.authored.read_bytes()
    source_digest = hashlib.sha256(source).hexdigest()
    if lee_sin:
        assert source_digest == "71e6f835ec86c21b65d17c2de6370a452ced7bab73ea6e9e1f7bfc7a0658d92f"
    else:
        assert source_digest == "ad2db3f0980ece3118bea353302bdc126caf63aa0082dfe64da53ac206557d73"
    row = json.loads(source)
    if lee_sin:
        authored = lee_sin_authored(row)
    else:
        event = next(event for event in row["events"] if event["handle"] == args.handle)
        assert event["descriptor"]["scaleRate"] == [2, 1]
        assert row["emitter"]["emitterName"]["value"] == "flash"
        authored = {
            "rate": 1,
            "lifetime": 0.10000000149011612,
            "EmitterPosition": [0, 0, 0],
            "particleLifetime": struct.unpack("<f", struct.pack("<f", 0.2))[0],
            "particleLinger": 1,
            "bindWeight": 1,
            "color": [1, 1, 1, 1],
            "birthRotation0": [1, 0, 0],
            "birthScale0": [200, 200, 200],
            "blendMode": 4,
        }
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))

    stop = 0x10000000
    heap_begin = stop + (0x20000 if lee_sin else 0x8000)
    heap_end = stop + (0x30000 if lee_sin else 0xA000)
    vm.mem_map(stop, 0x30000 if lee_sin else 0x18000)
    stack = stop + 0xF008
    definition, primitive, actor, link, system, quality = (stop + offset for offset in range(0x1000, 0x7000, 0x1000))

    def put(address, format_string, *values):
        vm.mem_write(address, struct.pack("<" + format_string, *values))

    def host_boundary(engine, address, _size, _data):
        nonlocal heap
        rdi = engine.reg_read(reg.UC_X86_REG_RDI)
        rsi = engine.reg_read(reg.UC_X86_REG_RSI)
        rva = address - image.base
        if rva in (0x14A0300, 0x14A2030, 0x14C5B20):
            if not 0 < rdi <= (0x1000 if lee_sin else 0x100) or heap + rdi > heap_end:
                raise ValueError("Original emitter allocation exceeds owned arena")
            engine.reg_write(reg.UC_X86_REG_RAX, heap)
            allocations.add(heap)
            heap += (rdi + 15) & ~15
        elif rva == 0x14C5B80:
            if rdi:
                if not lee_sin or rdi not in allocations:
                    raise ValueError("Unexpected release from a populated pool")
                allocations.remove(rdi)
        elif rva == 0x2051310:
            source = bytes(engine.mem_read(rdi, 128))
            engine.reg_write(reg.UC_X86_REG_RAX, source.index(0))
        elif rva == 0x2050F6E:
            size = engine.reg_read(reg.UC_X86_REG_RDX)
            if size > 128 or not (heap_begin <= rdi <= heap - size or stack - 0x1000 <= rdi <= stack - size):
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
        elif rva in (0x1959670, 0x17F3EC0):
            name = bytes(engine.mem_read(rsi, 32)).split(b"\0", 1)[0].decode("ascii")
            if rva == 0x1959670:
                material_parameters.append((name, engine.reg_read(reg.UC_X86_REG_EDX)))
            else:
                value = engine.reg_read(reg.UC_X86_REG_RDX)
                material_parameters.append((name, struct.unpack("<4f", engine.mem_read(value, 16))))
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

    def call(entry, rdi, rsi=0, time=None, end=stop, rdx=0):
        put(stack, "Q", stop)
        vm.reg_write(reg.UC_X86_REG_RSP, stack)
        vm.reg_write(reg.UC_X86_REG_RDI, rdi)
        vm.reg_write(reg.UC_X86_REG_RSI, rsi)
        vm.reg_write(reg.UC_X86_REG_RDX, rdx)
        if time is not None:
            vm.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", time))[0])
        vm.emu_start(image.base + entry, end, count=100000 if entry == 0x1773710 else 30000)
        result = vm.reg_read(reg.UC_X86_REG_RIP)
        if result != end:
            raise ValueError(f"Native emitter {entry:#x} did not complete: {result - image.base:#x}")
        return vm.reg_read(reg.UC_X86_REG_EAX)

    # Class registrations 0x1727d37 and 0x17e5067 identify these in-place
    # constructors. The rate and single-particle bindings are in the same
    # registration at 0x1727d90 and 0x1727e22.
    heap = heap_begin
    allocations = set()
    hooks = [
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
        for rva in (0x14A0300, 0x14A2030, 0x2051310, 0x2050F6E)
    ]
    call(0x14D501F, definition, end=image.base + 0x14D523E)
    call(0x17BDC20, definition)
    for hook in hooks:
        vm.hook_del(hook)
    (primitive,) = struct.unpack("<Q", vm.mem_read(definition + 0x60, 8))
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
    # Typed registrations bind these constants from 0x1727dc1 to 0x1728753.
    put(definition + 0x240, "3f", *authored["EmitterPosition"])
    put(definition + 0xF8, "f", authored["particleLifetime"])
    put(definition + 0x118, "f", authored["particleLinger"])
    if not lee_sin:
        put(definition + 0x388, "4f", *authored["color"])
        put(definition + 0x150, "4f", 0.686274528503418, 1, 0.7764706015586853, 1)
    put(definition + 0x3D0, "3f", *authored["birthRotation0"])
    put(definition + 0x3E8, "3f", *authored["birthScale0"])
    put(definition + 0x14, "B", authored["blendMode"])
    put(definition + 0x2D0, "I", flags | 0x100008)
    put(definition + 0x108, "f", authored["lifetime"])
    put(definition + 0x3A0, "f", authored["bindWeight"])

    # Feed the corroborated descriptor scalars through the facade's original
    # system-scale assignment boundary.
    facade = stop + 0x14800
    put(facade + 0x18, "I", 6)
    put(facade + 0x28, "Q", system)
    scale_rate = (1, 1) if lee_sin else (2, 1)
    put(facade + 0xB4, "2f", *scale_rate)
    vm.reg_write(reg.UC_X86_REG_RBX, facade)
    vm.emu_start(image.base + 0x17947D5, image.base + 0x1794804, count=32)
    assert vm.reg_read(reg.UC_X86_REG_RIP) == image.base + 0x1794804
    assert struct.unpack("<2f", vm.mem_read(system + 0x150, 8)) == scale_rate
    put(system + 0x1B0, "8f", *([1] * 8))
    # The outer update copies this separate system alpha into its context.
    put(system + 0x1D0, "f", 1)
    if lee_sin:
        # The replay provider's value is unresolved. Control the downstream
        # output of 0x17929C0 here, without inferring it from champion radii.
        put(system + 0x1D4, "f", args.lee_bound_size)
    put(system + 0x1F0, "2f", 1, 1)
    rotation, scale, data = [stop + n for n in (0xC000, 0xC100, 0xC200)]
    for node in (rotation, scale):
        call(0x17AFEC0, node)
    put(rotation + 0x20, "QII", data, 1, 1)
    put(rotation + 0x30, "QII", data + 0x20, 1, 1)
    put(data, "f", 0)
    put(data + 0x20, "3f", 1, 0, 0)
    probabilities = [data + n for n in (0x100, 0x140, 0x180)]
    for i, probability in enumerate(probabilities):
        put(rotation + 8 + i * 8, "Q", probability)
    put(probabilities[0], "QII", data + 0x40, 2, 2)
    put(probabilities[0] + 0x10, "QII", data + 0x60, 2, 2)
    put(probabilities[0] + 0x25, "B", 1)
    put(probabilities[1] + 0x24, "B", 1)
    put(probabilities[2] + 0x24, "B", 1)
    put(probabilities[1] + 0x20, "f", 1)
    put(probabilities[2] + 0x20, "f", 1)
    put(data + 0x40, "2f", 0, 1)
    rotation_values = (1, 90)
    if lee_sin:
        fields = row["emitter"]["fields"]
        rotation_curve = fields["5932ff9c"]["fields"]["bc037de7"]["fields"]
        probabilities_source = rotation_curve["a7084719"]["elements"][0]["fields"]
        rotation_values = [item["value"] for item in probabilities_source["e44b7382"]["elements"]]
    put(data + 0x60, "2f", *rotation_values)
    call(0x1703BA0, rotation)
    put(definition + 0x3E0, "Q", rotation)
    if lee_sin:
        bind_lee_sin_curves(fields, stop, definition, scale, data, vm, call, put)
    else:
        put(scale + 0x20, "QII", data + 0x80, 3, 3)
        put(scale + 0x30, "QII", data + 0xA0, 3, 3)
        put(data + 0x80, "3f", 0, 0.20000000298023224, 1)
        put(data + 0xA0, "9f", 0, 0, 0, 1, 1, 1, 0, 0, 0)

        call(0x1703BA0, scale)
        put(definition + 0x430, "Q", scale)
        birth_scale, life_curve = stop + 0xD000, stop + 0xD100
        call(0x17AFEC0, birth_scale)
        put(birth_scale + 0x20, "QII", data + 0x1C0, 1, 1)
        put(birth_scale + 0x30, "QII", data + 0x1D0, 1, 1)
        put(data + 0x1C0, "f", 0)
        put(data + 0x1D0, "3f", 200, 200, 200)
        for i in range(3):
            prob = data + 0x200 + i * 0x40
            put(birth_scale + 8 + i * 8, "Q", prob)
            vm.mem_write(prob, bytes(vm.mem_read(probabilities[i], 0x26)))
        put(data + 0x200 + 0x10, "QII", data + 0x330, 2, 2)
        put(data + 0x330, "2f", 0.7, 1)
        call(0x1703BA0, birth_scale)
        put(definition + 0x3F8, "Q", birth_scale)
        call(0x17AFB80, life_curve)
        life_prob = data + 0x360
        put(life_curve + 8, "Q", life_prob)
        vm.mem_write(life_prob, bytes(vm.mem_read(probabilities[0], 0x26)))
        put(life_prob + 0x10, "QII", data + 0x3A0, 2, 2)
        put(data + 0x3A0, "2f", 0.8, 1.1)
        put(life_curve + 0x10, "QII", data + 0x3B0, 1, 1)
        put(life_curve + 0x20, "QII", data + 0x3C0, 1, 1)
        put(data + 0x3B0, "f", 0)
        put(data + 0x3C0, "f", 0.2)
        put(life_curve + 0x3C, "If", 1, 0.2)
        put(definition + 0x100, "Q", life_curve)
    writer = struct.unpack("<Q", vm.mem_read(struct.unpack("<Q", vm.mem_read(primitive, 8))[0] + 0x28, 8))[0]
    view, draw, geometry, indices, vertices = [stop + n for n in (0xA000, 0xA100, 0xA200, 0xA300, 0xA400)]
    put(image.base + 0x24DC310, "Q", view + 0x88)
    vm.hook_add(
        unicorn.UC_HOOK_MEM_INVALID,
        lambda engine, access, address, size, value, data: (
            print("ERR", hex(engine.reg_read(reg.UC_X86_REG_RIP) - image.base), hex(address), file=sys.stderr) or False
        ),
    )

    def snapshot():
        put(geometry, "5Q", indices, vertices, draw, actor, view)
        put(view, "3f", 0, 0, 1000)
        put(view + 0x24, "3f", 0, 0, -1)
        view_row = stop + 0x11000
        put(quality + 0x360, "Q", view_row)
        put(view_row, "Q", view)
        put(stop + 0x14000, "3f", 0, 1, 0)
        put(stop + 0x14010, "3f", 1, 0, 0)
        call(0x1773710, view_row + 0x158, stop + 0x14000, rdx=stop + 0x14010)
        call(writer - image.base, primitive, geometry)
        index_end, vertex_end = struct.unpack("<2Q", vm.mem_read(geometry, 16))
        if index_end == indices:
            return None
        if index_end - indices != 12 * expected_count or vertex_end - vertices != 112 * expected_count:
            raise ValueError("Original CameraQuad writer exceeded the reviewed layout")
        return {
            "indices": index_end - indices,
            "indexBytes": bytes(vm.mem_read(indices, index_end - indices)).hex(),
            "vertices": vertex_end - vertices,
            "vertexBytes": bytes(vm.mem_read(vertices, vertex_end - vertices)).hex(),
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
    for rva in (0x2050D8E, 0x2050B90, 0x14C5B20, 0x14C5B80):
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
    rng_samples, updates, inserts, timeline = [], [], [], []
    seed = None
    if args.random_control == "seeded":
        # Native client startup passes mach_absolute_time to this setter.
        # The preview has a stable independent seed for this event.
        replay = "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
        seed = int.from_bytes(hashlib.sha256(f"{replay}:{args.handle}".encode()).digest()[:8], "little")
        initialized, thread_ready, stream = (stop + n for n in (0x15000, 0x15010, 0x15020))
        put(thread_ready, "B", 1)
        put(stream, "Q", image.base + 0x23BD3B0)

        def resolve_tls(address, target):
            def resume(cpu, *_):
                cpu.reg_write(reg.UC_X86_REG_RAX, target)
                cpu.reg_write(reg.UC_X86_REG_RIP, image.base + address + 2)

            vm.hook_add(unicorn.UC_HOOK_CODE, resume, begin=image.base + address, end=image.base + address)

        for address, target in (
            (0x14BC76A, initialized),
            (0x14BC63E, initialized),
            (0x14BC64A, thread_ready),
            (0x14BC663, stream),
            (0x14BC693, stream),
            (0x14BC6B4, thread_ready),
        ):
            resolve_tls(address, target)
        call(0x14BC750, seed)

        def capture_random(cpu, address, *_):
            bits = cpu.reg_read(reg.UC_X86_REG_XMM0) & 0xFFFFFFFF
            rng_samples.append(struct.unpack("<f", struct.pack("<I", bits))[0])

        # Observe the Vec3 probability and palette-Y call sites. The scalar
        # lifetime selection is witnessed by the original pool insertion.
        for address in (0x1705036, 0x1788B11):
            vm.hook_add(unicorn.UC_HOOK_CODE, capture_random, begin=image.base + address, end=image.base + address)
    else:
        supplied_random = float(args.random_control)
        address = image.base + 0x14BC630
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=address, end=address)
    vm.mem_write(actor + 0x24, previous_clock_marker)
    put(actor + 0x18, "B", 0)
    expected_count = 3 if lee_sin else 1
    for currentTime in [i / 120 for i in range(150 if lee_sin else 32)]:
        call(0x1786280, actor, time=currentTime)
        (count,) = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))
        timeline.append([currentTime, count, snapshot() if count else None])
    assert len(inserts) == expected_count, inserts
    assert len(rng_samples) in ((6,) if lee_sin else (3, 4))
    assert all(
        count == 0
        or (
            count == expected_count
            and geometry["vertices"] == 112 * expected_count
            and geometry["indices"] == 12 * expected_count
        )
        for _, count, geometry in timeline
    )

    # Request the original render state before the platform GPU setter.
    material_parameters = []
    for rva in (0x1959670, 0x17F3EC0):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
    passes = [number for number in range(7) if call(0x1709A00, link, rsi=number) & 0xFF]
    assert len(passes) == 1
    for rva in (0x14A2030, 0x2051310, 0x2050F6E):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
    call(0x1709BA0, link, rsi=passes[0], end=image.base + 0x170CDC0)

    def stage(register):
        pointer, length, capacity = struct.unpack("<QII", vm.mem_read(vm.reg_read(register), 16))
        assert 0 < length < capacity <= 256 and stack - 0x1000 <= pointer < stack
        return bytes(vm.mem_read(pointer, length)).decode("ascii")

    stages = [stage(reg.UC_X86_REG_RSI), stage(reg.UC_X86_REG_RDX)]
    assert stages == ["ParticleSystem/QUAD_PS.ps", "ParticleSystem/QUAD_VS.vs"]
    (define_count,) = struct.unpack("<I", vm.mem_read(vm.reg_read(reg.UC_X86_REG_RCX) + 8, 4))
    request_flags = bytes(vm.mem_read(vm.reg_read(reg.UC_X86_REG_R9), 10))
    assert define_count == 0 and not any(request_flags)
    frame = stack - 0x40
    vm.mem_write(frame - 0x228, bytes(0x228))
    put(frame - 0x184, "I", vm.mem_read(primitive + 8, 1)[0])
    put(view, "B", passes[0])
    for register, value in (
        (reg.UC_X86_REG_RBP, frame),
        (reg.UC_X86_REG_RSP, frame - 0x228),
        (reg.UC_X86_REG_RBX, link),
        (reg.UC_X86_REG_R12, frame - 0x17C),
        (reg.UC_X86_REG_R13, draw),
        (reg.UC_X86_REG_R14, view),
        (reg.UC_X86_REG_R15, 0),
    ):
        vm.reg_write(register, value)
    vm.emu_start(image.base + 0x1708ED0, image.base + 0x1708E7A, count=1000)
    assert vm.reg_read(reg.UC_X86_REG_RIP) == image.base + 0x1708E7A
    descriptor = bytes(vm.mem_read(frame - 0x180, 32)).hex()
    print(
        json.dumps(
            {
                "archiveSha256": digest,
                "authoredSha256": source_digest,
                "authored": authored,
                "handle": args.handle,
                **({"controlledSystemBoundSize": args.lee_bound_size} if lee_sin else {}),
                "updates": updates,
                "inserts": inserts,
                "timeline": timeline,
                "rngSamples": rng_samples,
                "seedHex": None if seed is None else f"{seed:016x}",
                "material": {
                    "pass": passes[0],
                    "descriptorHex": descriptor,
                    "parameters": material_parameters,
                    "stages": stages,
                    "defineCount": define_count,
                    "requestFlagsHex": request_flags.hex(),
                },
            },
            allow_nan=False,
        )
    )


if __name__ == "__main__":
    main()
