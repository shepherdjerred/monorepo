"""Sample the verified .8428 Heimerdinger Q Ammo Spend bubble offline.

Run with Unicorn and the pinned 45f7e988 authored definition receipt. Capture
stdout for each random control, 0.125 and 0.875. The receipt covers local initial
state, birth, positive-age CameraQuad geometry, and the native material request.
It uses an owned scene and camera, and does not exercise emitter teardown or
the sibling Flash_Anim and mesh emitters.
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("authored", type=Path)
    parser.add_argument("random_control", type=float, choices=(0.125, 0.875))
    args = parser.parse_args()
    if not __debug__:
        raise RuntimeError("Run this verification without Python optimizations")
    binary = args.executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    assert digest == "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
    image = read_replication_image(binary, CURRENT_BUILD)
    source = args.authored.read_bytes()
    source_digest = hashlib.sha256(source).hexdigest()
    assert source_digest == "acbfae2868b2c3720cd8eb59ffe4dcb11354770f6771bc5fe87f67b3f999a44b"
    row = json.loads(source)
    fields = row["object"]["fields"]["complexEmitterDefinitionData"]["elements"][2]["fields"]
    assert fields["emitterName"]["value"] == "bubble"
    authored = {
        "rate": 1,
        "lifetime": 1,
        "EmitterPosition": [0, 50, 0],
        "particleLifetime": 0.5,
        "particleLinger": 0,
        "bindWeight": 1,
        "color": [1, 1, 1, 1],
        "birthRotation0": [0, 0, 0],
        "birthScale0": [25, 25, 25],
        "blendMode": 0,
    }
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))

    stop = 0x10000000
    vm.mem_map(stop, 0x10000)
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
            if not 0 < rdi <= 0x100 or heap + rdi > stop + 0xA000:
                raise ValueError("Original emitter allocation exceeds owned arena")
            engine.reg_write(reg.UC_X86_REG_RAX, heap)
            heap += (rdi + 15) & ~15
        elif rva == 0x14C5B80:
            if rdi != 0:
                raise ValueError("Unexpected release from a populated pool")
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
        return vm.reg_read(reg.UC_X86_REG_EAX)

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
    put(definition + 0x3A0, "f", authored["bindWeight"])
    put(definition + 0x388, "4f", *authored["color"])
    put(definition + 0x3D0, "3f", *authored["birthRotation0"])
    put(definition + 0x3E8, "3f", *authored["birthScale0"])
    put(definition + 0x14, "B", authored["blendMode"])
    put(definition + 0x2D0, "I", (flags | 0x100000) & ~0x200000)
    shape = stop + 0x7900
    call(0x17C59D0, shape)
    put(definition + 0x238, "Q", shape)
    put(shape + 8, "3f", 0, 50, 0)
    put(system + 0x150, "2f", 1, 1)
    put(system + 0x1B0, "8f", *([1] * 8))
    # The outer update copies this separate system alpha into its context.
    put(system + 0x1D0, "f", 1)
    put(system + 0x1F0, "2f", 1, 1)
    color_curve, scale_curve, curves_data = [stop + n for n in (0xC000, 0xC100, 0xC200)]
    call(0x17B0430, color_curve)
    call(0x17AFEC0, scale_curve)
    put(definition + 0x398, "Q", color_curve)
    put(definition + 0x430, "Q", scale_curve)
    put(color_curve + 0x28, "QII", curves_data, 3, 3)
    put(color_curve + 0x38, "QII", curves_data + 0x20, 3, 3)
    put(curves_data, "3f", 0, 0.10000000149011612, 1)
    put(curves_data + 0x20, "12f", 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.30000001192092896, 0, 0)
    put(scale_curve + 0x20, "QII", curves_data + 0x60, 2, 2)
    put(scale_curve + 0x30, "QII", curves_data + 0x80, 2, 2)
    put(curves_data + 0x60, "2f", 0, 1)
    put(curves_data + 0x80, "6f", 1, 1, 1, 0, 0, 0)
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
        view_row = stop + 0xE000
        put(quality + 0x360, "Q", view_row)
        put(view_row, "Q", view)
        put(view_row + 0x170, "6f", 1, 0, 0, 0, 1, 0)
        call(writer - image.base, primitive, geometry)
        index_end, vertex_end = struct.unpack("<2Q", vm.mem_read(geometry, 16))
        if index_end == indices:
            return None
        if index_end - indices != 12 or vertex_end - vertices != 112:
            raise ValueError("Original CameraQuad writer exceeded the reviewed layout")
        return {
            "indices": 12,
            "indexBytes": bytes(vm.mem_read(indices, 12)).hex(),
            "vertices": 112,
            "vertexBytes": bytes(vm.mem_read(vertices, 112)).hex(),
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
    supplied_random = args.random_control
    rng_samples, updates, inserts, timeline = [], [], [], []
    vm.mem_write(actor + 0x24, previous_clock_marker)
    put(actor + 0x18, "B", 0)
    for currentTime in [f * authored["particleLifetime"] for f in [0, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]]:
        call(0x1786280, actor, time=currentTime)
        (count,) = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))
        timeline.append([currentTime, count, snapshot() if count else None])
    assert len(inserts) == 1 and inserts[0]["position"] == (0, 100, 0)
    assert all(
        count == 1 and geometry["vertices"] == 112 and geometry["indices"] == 12 for _, count, geometry in timeline
    )

    # Request the original render state before the platform GPU setter.
    material_parameters = []
    for rva in (0x1959670, 0x17F3EC0):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
    passes = [number for number in range(7) if call(0x1709A00, link, rsi=number) & 0xFF]
    assert passes == [4]
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
                "updates": updates,
                "inserts": inserts,
                "timeline": timeline,
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
