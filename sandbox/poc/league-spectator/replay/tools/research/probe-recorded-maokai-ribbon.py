"""Execute the original .8428 Maokai emitter 6 and ArbitraryTrail writer.

Run from the repository root using Unicorn and the Windows CRT. The emitter
receipt contains the original Maokai skin 33 VFX definition. The motion receipt
comes from probe-rift-maokai-movement.py. Use slots 0, 1, and 2 with both random
inputs (0.125 and 0.875) before preparing the private track. For a reviewed
visible-prefix motion receipt, use --discovery-sha256 and one of its case slots.
Discovery covers other casts in the same saved .8428 match. The original
skin-33 roster binding and authored emitter remain pinned.

The probe reproduces the native parent request, basis and root-position handoff,
rate, birth, particle aging, CPU writer and material selection with owned scene
objects. It uses controlled clocks, external math and random responses. World
geometry is sampled through recorded contact or stop. GPU draws, visibility,
and live emitter teardown are outside the probe.
"""

import argparse
import ctypes
import hashlib
import json
import math
import struct
import sys
from collections import deque
from itertools import pairwise
from pathlib import Path

import unicorn
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image

VISIBLE_MASK_PACKET_HASHES = {
    "8c25b3494723a39b933e5a4ce5f139279586ffe1a70f98abacf903a2b0f4c258",
    "c616d342397df9f01b60c9d363aa4a9c1205344587166e8960efacafae6865df",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("executable", "motion_receipt", "effect_receipt"):
        parser.add_argument(name, type=Path)
    parser.add_argument("slot", type=int)
    parser.add_argument("random_sample", type=float, choices=(0.125, 0.875))
    parser.add_argument("output", type=Path)
    parser.add_argument("--discovery-sha256", help="Reviewed visible-prefix motion receipt hash")
    if not __debug__:
        parser.error("Run without Python optimization so native validation is active")
    args = parser.parse_args()
    if not args.output.parent.resolve().is_relative_to(Path(".cache").resolve()) or args.output.exists():
        raise ValueError("Expected a fresh private .cache output")
    binary = args.executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    image = read_replication_image(binary, CURRENT_BUILD)
    motion_bytes = args.motion_receipt.read_bytes()
    asset_bytes = args.effect_receipt.read_bytes()
    assert digest == "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
    cohorts = {
        "2c97bd8d259a544f2e145e47bbedd676b6b0e912991f2a1eaa283c337ae1b94a": (1073820771, 1073820782, 1073820791),
        "11dfea28db28ca841a38e21d0cd53620bfaab98895ea99288bc340b0c9c7f5cf": (1073820800, 1073820809),
    }
    motion_digest = hashlib.sha256(motion_bytes).hexdigest()
    assert hashlib.sha256(asset_bytes).hexdigest() == "d16ac8262fa12cb2d239cbda480c77221eb85e105f1d72a5bd0421008f32df3c"
    motion = json.loads(motion_bytes)
    discovery = args.discovery_sha256 is not None
    if discovery:
        assert motion_digest == args.discovery_sha256
        assert motion["build"] == CURRENT_BUILD
        assert motion["protocol"] == "8bbfcd5af2bc92db"
        assert motion["replaySha256"] == "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
        assert motion["decoderSha256"] == digest
        assert motion["navgridSha256"] == "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9"
        assert motion["visibilityReceiverRva"] == "0x21fe40"
    else:
        assert motion_digest in cohorts
        assert tuple(case["entity"] for case in motion["cases"]) == cohorts[motion_digest]
    assert 0 <= args.slot < len(motion["cases"])
    asset = json.loads(asset_bytes)
    atan2f = ctypes.CDLL("ucrtbase.dll").atan2f
    atan2f.argtypes = [ctypes.c_float, ctypes.c_float]
    atan2f.restype = ctypes.c_float
    fields = next(value for value in asset["object"]["fields"].values() if len(value.get("elements", [])) == 22)[
        "elements"
    ][6]["fields"]
    assert fields["007b14f6"]["classHash"] == "5705625a"
    assert set(fields) == {
        "ae839c67",
        "2a552694",
        "5212abee",
        "3d25b8ce",
        "b9516a6f",
        "3bf0b4ed",
        "007b14f6",
        "fa784eab",
        "83cdeaa1",
        "3d7e6258",
        "67b5d729",
        "3559e15b",
        "27d40903",
        "f0eb7084",
        "3c6468f4",
        "eddebb48",
    }, sorted(fields)
    trail = fields["007b14f6"]["fields"]["5e661fd4"]["fields"]

    def constant(key):
        return fields[key]["fields"]["b4b427aa"]["value"]

    def vec(value):
        return list(value.values())

    authored = {
        "rate": constant("ae839c67"),
        "lifetime": fields["5212abee"]["value"]["value"],
        "particleLifetime": constant("2a552694"),
        "blendMode": fields["fa784eab"]["value"],
        "birthColor": vec(constant("83cdeaa1")),
        "birthScale0": vec(constant("f0eb7084")),
        "offset": vec(fields["3bf0b4ed"]["fields"]["e5f268dd"]["value"]),
        "trailMode": trail["0ea6d9c1"]["value"],
        "trailSmoothing": trail["ac59cf4b"]["value"],
        "trailCutoff": trail["ee88201d"]["value"],
        "trailTiling": vec(trail["8c784fc7"]["fields"]["b4b427aa"]["value"]),
        "uvScale": vec(constant("eddebb48")),
        "uvMode": vec(fields["67b5d729"]["value"]),
    }
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))

    stop = 0x10000000
    vm.mem_map(stop, 0x400000)
    stack = stop + 0xF008
    definition, _default_primitive, actor, link, system, quality = (
        stop + offset for offset in range(0x1000, 0x7000, 0x1000)
    )

    def put(address, format_string, *values):
        vm.mem_write(address, struct.pack("<" + format_string, *values))

    def host_boundary(engine, address, _size, _data):
        nonlocal heap
        rdi = engine.reg_read(reg.UC_X86_REG_RDI)
        rsi = engine.reg_read(reg.UC_X86_REG_RSI)
        rva = address - image.base
        if rva in (0x14A0300, 0x14A2030, 0x14C5B20):
            if not 0 < rdi <= 0x100000 or heap + rdi > stop + 0x400000:
                raise ValueError("Original emitter allocation exceeds owned arena")
            engine.reg_write(reg.UC_X86_REG_RAX, heap)
            heap += (rdi + 15) & ~15
        elif rva == 0x14C5B80:
            assert rdi == 0 or stop + 0x30000 <= rdi < heap
        elif rva == 0x2051310:
            source = bytes(engine.mem_read(rdi, 128))
            engine.reg_write(reg.UC_X86_REG_RAX, source.index(0))
        elif rva in (0x2050F6E, 0x2050F74):
            size = engine.reg_read(reg.UC_X86_REG_RDX)
            if size > 0x100000 or not (stop <= rdi <= stop + 0x400000 - size):
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
        elif rva == 0x2050A10:
            assert rdi == weak
            put(weak + 8, "Q", struct.unpack("<Q", engine.mem_read(weak + 8, 8))[0] + 1)
            engine.reg_write(reg.UC_X86_REG_RAX, weak)
        elif rva == 0x5587F0:
            requested_source_contexts.append(engine.reg_read(reg.UC_X86_REG_ESI))
            engine.reg_write(reg.UC_X86_REG_RAX, 0)
        elif rva == 0x1959470:
            material_stages.append(bytes(engine.mem_read(rdi, 64)).split(b"\0")[0].decode("ascii"))
            engine.reg_write(reg.UC_X86_REG_RAX, rdi)
            if len(material_stages) == 2:
                engine.emu_stop()
        elif rva == 0x170CDC0:
            rdx = engine.reg_read(reg.UC_X86_REG_RDX)
            for ptr in (rsi, rdx):
                string = struct.unpack("<Q", engine.mem_read(ptr, 8))[0]
                material_stages.append(bytes(engine.mem_read(string, 96)).split(b"\0")[0].decode("ascii"))
            defines = engine.reg_read(reg.UC_X86_REG_RCX)
            flags = engine.reg_read(reg.UC_X86_REG_R9)
            material_state["defineCount"] = struct.unpack("<I", engine.mem_read(defines + 8, 4))[0]
            material_state["requestFlagsHex"] = bytes(engine.mem_read(flags, 10)).hex()
            engine.emu_stop()
        elif rva in (0x1959670, 0x17F3EC0):
            name = bytes(engine.mem_read(rsi, 32)).split(b"\0", 1)[0].decode("ascii")
            if rva == 0x1959670:
                material_parameters.append((name, engine.reg_read(reg.UC_X86_REG_EDX)))
            else:
                value = engine.reg_read(reg.UC_X86_REG_RDX)
                material_parameters.append((name, struct.unpack("<4f", engine.mem_read(value, 16))))
        elif rva in (0x2050D8E, 0x2050C44):

            def argument(register):
                bits = engine.reg_read(register) & 0xFFFFFFFF
                return struct.unpack("<f", struct.pack("<I", bits))[0]

            operation = math.fmod if rva == 0x2050D8E else atan2f
            value = operation(argument(reg.UC_X86_REG_XMM0), argument(reg.UC_X86_REG_XMM1))
            engine.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", value))[0])
        rsp = engine.reg_read(reg.UC_X86_REG_RSP)
        (target,) = struct.unpack("<Q", engine.mem_read(rsp, 8))
        engine.reg_write(reg.UC_X86_REG_RSP, rsp + 8)
        engine.reg_write(reg.UC_X86_REG_RIP, target)

    def call(entry, rdi, rsi=0, time=None, end=stop, rdx=0, rbx=0):
        put(stack, "Q", stop)
        vm.reg_write(reg.UC_X86_REG_RSP, stack)
        vm.reg_write(reg.UC_X86_REG_RDI, rdi)
        vm.reg_write(reg.UC_X86_REG_RSI, rsi)
        vm.reg_write(reg.UC_X86_REG_RDX, rdx)
        vm.reg_write(reg.UC_X86_REG_RBX, rbx)
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
    heap = stop + 0x30000
    hooks = [
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
        for rva in (0x14A0300, 0x14A2030, 0x2051310, 0x2050F6E)
    ]
    call(0x14D501F, definition, end=image.base + 0x14D523E)
    call(0x17BDC20, definition)
    color_pointer, color_length, _ = struct.unpack("<QII", vm.mem_read(definition + 0xA8, 16))
    assert bytes(vm.mem_read(color_pointer, color_length)) == b"ASSETS/Shared/Particles/DefaultColorOverlifetime.png"
    for hook in hooks:
        vm.hook_del(hook)
    primitive = stop + 0x8000
    call(0x17D7A30, primitive)
    assert struct.unpack("<Q", vm.mem_read(primitive, 8))[0] == image.base + 0x24699C8
    put(primitive + 0x10, "3f", *authored["trailTiling"])
    put(primitive + 0x28, "f", authored["trailCutoff"])
    put(primitive + 0x30, "2B", authored["trailMode"], authored["trailSmoothing"])
    (period_bits,) = struct.unpack("<I", vm.mem_read(definition + 0x224, 4))
    if period_bits != 0x7F7FFFFF:
        raise ValueError("Unexpected native emitter period")

    put(definition + 0x1F0, "f", authored["rate"])
    (flags,) = struct.unpack("<I", vm.mem_read(definition + 0x2D0, 4))
    put(definition + 0x2D0, "I", (flags & ~0x100000) | 0x1000)
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
    call(0x14B4E00, image.base + 0x25E5ED0)
    # Typed registrations bind these constants starting at 0x1727dc1.
    put(definition + 0xF8, "f", authored["particleLifetime"])
    put(definition + 0x108, "f", authored["lifetime"])
    put(definition + 0x150, "4f", *authored["birthColor"])
    put(definition + 0x3E8, "3f", *authored["birthScale0"])
    put(definition + 0x14, "B", authored["blendMode"])
    put(definition + 0x17, "B", fields["b9516a6f"]["value"])
    put(definition + 0x7C, "2f", *authored["uvMode"])
    put(definition + 0x450, "2f", *authored["uvScale"])
    put(definition + 0x2D0, "I", (flags & ~0x100000) | 0x1000 | 8)
    shape = stop + 0x7900
    call(0x17C59D0, shape)
    put(definition + 0x238, "Q", shape)
    put(shape + 8, "3f", *authored["offset"])
    put(system + 0x150, "2f", 1, 1)
    put(system + 0x1B0, "8f", *([1] * 8))
    # The outer update copies this separate system alpha into its context.
    put(system + 0x1D0, "f", 1)
    put(system + 0x1F0, "2f", 1, 1)
    for index, (field, offset) in enumerate((("83cdeaa1", 0x160), ("3d7e6258", 0x398))):
        curve = stop + 0xC000 + index * 0x300
        values = fields[field]["fields"]["bc037de7"]["fields"]
        times = [cell["value"] for cell in values["5d68eeb5"]["elements"]]
        colors = [entry for cell in values["34474c3b"]["elements"] for entry in vec(cell["value"])]
        count = len(times)
        call(0x17B0430, curve)
        put(definition + offset, "Q", curve)
        put(curve + 0x28, "QII", curve + 0x100, count, count)
        put(curve + 0x38, "QII", curve + 0x140, count, count)
        put(curve + 0x100, f"{count}f", *times)
        put(curve + 0x140, f"{count * 4}f", *colors)
    writer = struct.unpack("<Q", vm.mem_read(struct.unpack("<Q", vm.mem_read(primitive, 8))[0] + 0x28, 8))[0]
    assert writer - image.base == 0x1762F50
    view, draw, geometry, indices, vertices = [stop + n for n in (0xA000, 0xA100, 0xA200, 0x10000, 0x18000)]
    put(image.base + 0x24DC310, "Q", view + 0x88)
    vm.hook_add(
        unicorn.UC_HOOK_MEM_INVALID,
        lambda engine, access, address, size, value, data: (
            print("ERR", hex(engine.reg_read(reg.UC_X86_REG_RIP) - image.base), hex(address), file=sys.stderr) or False
        ),
    )
    blocks = deque(maxlen=24)
    vm.hook_add(unicorn.UC_HOOK_BLOCK, lambda _engine, address, _size, _data: blocks.append(address - image.base))

    def snapshot():
        vm.mem_write(draw, bytes(16))
        put(geometry, "5Q", indices, vertices, draw, actor, view)
        put(view, "3f", 0, 0, 1000)
        put(view + 0x24, "3f", 0, 0, -1)
        view_row = stop + 0xE000
        put(quality + 0x360, "Q", view_row)
        put(view_row, "Q", view)
        put(view_row + 0x170, "6f", 1, 0, 0, 0, 1, 0)
        try:
            call(writer - image.base, primitive, geometry)
        except unicorn.UcError:
            print("writer", material_stages, [hex(p) for p in blocks], file=sys.stderr)
            raise
        index_end, vertex_end = struct.unpack("<2Q", vm.mem_read(geometry, 16))
        if index_end == indices:
            return None
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
    for rva in (
        0x2050D8E,
        0x2050B90,
        0x14BC630,
        0x14C5B20,
        0x14C5B80,
        0x2050F74,
        0x2050A10,
        0x1959470,
        0x170CDC0,
        0x2050F6E,
        0x2051310,
        0x2050C44,
        0x1959670,
        0x17F3EC0,
        0x5587F0,
        0x14A0300,
    ):
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
    supplied_random = args.random_sample
    rng_samples, updates, inserts, timeline = [], [], [], []
    vm.mem_write(actor + 0x24, previous_clock_marker)
    put(actor + 0x18, "B", 0)
    projectile = motion["cases"][args.slot]
    if discovery:
        start = projectile["recordedLaunchTimeSeconds"]
        end = projectile["motionVerifiedThroughSeconds"]
        assert projectile["sourceContext"] == 1073742170
        assert projectile["recordedStopTimeSeconds"] is None
        assert projectile["firstUnclassifiedPacket"]["seconds"] == end
        assert start < end
        assert projectile["birthVisibilityPackets"]
        assert all(
            packet["seconds"] == start
            and packet["opcode"] == 66
            and packet["bodyBytes"] == 2
            and packet["bodySha256"] in VISIBLE_MASK_PACKET_HASHES
            for packet in projectile["birthVisibilityPackets"]
        )
        clocks = [sample["timeSeconds"] for sample in projectile["samples"]]
        assert clocks[0] == start and clocks[-1] == end
        assert all(left < right for left, right in pairwise(clocks))
    previous = projectile["samples"][0]["positionXYZ"]
    facade, weak, holder, owner, projectile_actor, move_spec, callback, scratch = [
        stop + 0x1F000 + 0x1000 * i for i in range(8)
    ]
    put(facade + 0x28, "Q", system)
    put(projectile_actor + 0x358, "Q", move_spec)
    call(0x8AD390, callback, projectile_actor)
    descriptor, encoded_owner, spell = [scratch + n * 0x300 for n in (1, 2, 3)]

    def ror(number, count):
        width = 2**64 - 1
        number &= width
        return (number >> count) | ((number << (64 - count)) & width)

    mask, key, additive = 2**64 - 1, 0x8403AC5D, 0xFFFFFFFF0087EA4F
    put(descriptor, "Q", ror(ror(encoded_owner ^ (key + 0x417BEE73), 47) ^ key, 11))
    inner = ((spell - additive - 0x7B746954) & mask) ^ 0x50B3152B
    inner = ((inner - additive) & mask) ^ (key + 0x11C8E39E)
    put(encoded_owner + 0x78, "Q", ((ror(inner, 16) ^ key) - additive) & mask)
    put(descriptor + 0x90, "I", 1073742170)
    put(projectile_actor + 0x160, "3f", *previous)
    put(spell + 0x3FC, "I", asset["effectKey"])
    put(image.base + 0x24E85B0, "Q", scratch + 0xC00)
    requested_source_contexts = []
    call(0x8AD3F0, callback, projectile_actor + 0x160, rdx=descriptor, end=image.base + 0x8AD7D0)
    assert requested_source_contexts == [1073742170]
    assert vm.reg_read(reg.UC_X86_REG_R8) == projectile_actor + 0x160
    assert vm.reg_read(reg.UC_X86_REG_EDX) == asset["effectKey"]
    spawn = {"key": asset["effectKey"], "positionXYZ": previous, "sourceContext": requested_source_contexts[0]}
    put(callback + 0x10, "QQ", holder, weak)
    put(holder, "Q", owner)
    put(weak + 8, "Q", 1)
    put(owner + 0x188, "Q", facade)
    put(link + 0x18, "B", 1)
    material_stages = []
    material_state = {}
    valid_passes = [render_pass for render_pass in range(7) if call(0x1709A00, link, rsi=render_pass) & 255]
    assert len(valid_passes) == 1, valid_passes
    material_state["pass"] = valid_passes[0]
    vm.reg_write(reg.UC_X86_REG_RSP, stack)
    vm.reg_write(reg.UC_X86_REG_RDI, link)
    vm.reg_write(reg.UC_X86_REG_RSI, valid_passes[0])
    vm.reg_write(reg.UC_X86_REG_RDX, scratch)
    try:
        vm.emu_start(image.base + 0x1709BA0, stop, count=30000)
    except unicorn.UcError:
        print("material", [hex(p) for p in blocks], material_stages, file=sys.stderr)
        raise
    if len(material_stages) != 2:
        raise ValueError(f"Native shader stage capture ended at {vm.reg_read(reg.UC_X86_REG_RIP) - image.base:#x}")
    material_parameters = []
    frame = stack - 0x40
    vm.mem_write(frame - 0x228, bytes(0x228))
    put(frame - 0x184, "I", 5)
    put(view, "B", valid_passes[0])
    for register, address in (
        (reg.UC_X86_REG_RBP, frame),
        (reg.UC_X86_REG_RSP, frame - 0x228),
        (reg.UC_X86_REG_RBX, link),
        (reg.UC_X86_REG_R12, frame - 0x17C),
        (reg.UC_X86_REG_R13, draw),
        (reg.UC_X86_REG_R14, view),
        (reg.UC_X86_REG_R15, 0),
    ):
        vm.reg_write(register, address)
    vm.ctl_remove_cache(image.base + 0x1708E7A, image.base + 0x1709242)
    vm.emu_start(image.base + 0x1708ED0, image.base + 0x1708E7A, count=1000)
    assert vm.reg_read(reg.UC_X86_REG_RIP) == image.base + 0x1708E7A
    material_state["descriptorHex"] = bytes(vm.mem_read(frame - 0x180, 32)).hex()
    material_state["parameters"] = material_parameters
    assert struct.unpack_from("<8Q", image.image, 0x2158DA0) == (7, 0, 1, 3, 4, 6, 2, 5)
    assert struct.unpack_from("<11Q", image.image, 0x2158E50) == (0, 1, 2, 3, 6, 7, 4, 5, 8, 9, 11)
    name = fields["3c6468f4"]["value"]
    encoded = name.encode("ascii") + b"\0"
    vm.mem_write(scratch, encoded)
    put(definition + 0x98, "QII", scratch, len(encoded) - 1, len(encoded))
    put(stack, "Q", stop)
    vm.reg_write(reg.UC_X86_REG_RSP, stack)
    vm.reg_write(reg.UC_X86_REG_RBP, stack - 0x100)
    vm.reg_write(reg.UC_X86_REG_RBX, link)
    vm.emu_start(image.base + 0x1708E28, image.base + 0x14C53D0, count=16)
    assert vm.reg_read(reg.UC_X86_REG_RIP) == image.base + 0x14C53D0
    assert vm.reg_read(reg.UC_X86_REG_RDI) == definition + 0x98
    (resume,) = struct.unpack("<Q", vm.mem_read(vm.reg_read(reg.UC_X86_REG_RSP), 8))
    vm.reg_write(reg.UC_X86_REG_RSP, stack)
    vm.reg_write(reg.UC_X86_REG_RAX, 0x1234)
    vm.ctl_remove_cache(image.base + 0x170D330, image.base + 0x170D481)
    vm.emu_start(resume, image.base + 0x170D330, count=32)
    assert vm.reg_read(reg.UC_X86_REG_RIP) == image.base + 0x170D330
    assert vm.reg_read(reg.UC_X86_REG_RCX) == 0
    vm.emu_start(image.base + 0x170D330, image.base + 0x170D481, count=500)
    assert vm.reg_read(reg.UC_X86_REG_RIP) == image.base + 0x170D481
    sampler_frame = vm.reg_read(reg.UC_X86_REG_RBP)
    (semantic_pointer,) = struct.unpack("<Q", vm.mem_read(image.base + 0x2462750, 8))
    assert bytes(vm.mem_read(semantic_pointer, 8)) == b"TEXTURE\0"
    material_state["texture"] = {
        "path": name,
        "slot": 0,
        "semantic": "TEXTURE",
        "samplerDescriptorHex": bytes(vm.mem_read(sampler_frame - 0x40, 5)).hex(),
        "sha256": next(row["sha256"] for row in asset["assets"] if row["path"] == name),
    }
    for sample in projectile["samples"]:
        currentTime = sample["timeSeconds"] - projectile["recordedLaunchTimeSeconds"]
        put(scratch, "3f", *sample["velocityXYZ"])
        call(0x8AE780, callback, scratch)
        call(0x1794B03, 0, end=image.base + 0x1794B36, rbx=facade)
        put(system + 0xFC, "3f", *previous)
        put(scratch, "3f", *sample["positionXYZ"])
        call(0x1795D50, facade, scratch)
        call(0x1794BC0, 0, end=image.base + 0x1794C4E, rbx=facade)
        try:
            call(0x1786280, actor, time=currentTime)
        except unicorn.UcError:
            print(currentTime, [hex(p) for p in blocks], file=sys.stderr)
            raise
        (count,) = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))
        timeline.append([currentTime, count, snapshot() if count else None])
        previous = sample["positionXYZ"]
    with args.output.open("xb") as file:
        file.write(
            (
                json.dumps(
                    {
                        "authored": authored,
                        "flags": hex(flags),
                        "entity": projectile["entity"],
                        "spawn": spawn,
                        "updates": updates,
                        "inserts": inserts,
                        "timeline": timeline,
                        "rngSamples": rng_samples,
                        "materialStages": material_stages,
                        "materialState": material_state,
                        **(
                            {
                                "motionReceiptSha256": motion_digest,
                                "decoderSha256": digest,
                                "slot": args.slot,
                                "randomSample": args.random_sample,
                            }
                            if discovery
                            else {}
                        ),
                    },
                    allow_nan=False,
                )
                + "\r\n"
            ).encode("utf-8")
        )


if __name__ == "__main__":
    main()
