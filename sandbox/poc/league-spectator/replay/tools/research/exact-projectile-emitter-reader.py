"""Execute the original emitter, its pool insertion, and ArbitraryQuad writer."""

import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import unicorn
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage


def main():
    binary = Path(sys.argv[1]).read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    if digest != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15":
        raise ValueError("Expected reviewed exact 16.23.840.6595 executable bytes")

    authored = json.load(sys.stdin)
    if (authored["rate"], authored["isSingleParticle"], authored["primitive"]) != (
        1, 1, "VfxPrimitiveArbitraryQuad",
    ):
        raise ValueError("Unexpected Zoe Q recast emitter")

    image = MachImage(binary)
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))

    stop = 0x10000000
    vm.mem_map(stop, 0x10000)
    stack = stop + 0xF008
    definition, primitive, actor, link, system, quality, context = (
        stop + offset for offset in range(0x1000, 0x8000, 0x1000)
    )

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
            if size > 128 or not (
                stop + 0x8000 <= rdi <= heap - size or
                stack - 0x1000 <= rdi <= stack - size
            ):
                raise ValueError("Original emitter copy outside owned memory")
            engine.mem_write(rdi, bytes(engine.mem_read(rsi, size)))
            engine.reg_write(reg.UC_X86_REG_RAX, rdi)
        elif rva == 0x2050B90:
            bits = engine.reg_read(reg.UC_X86_REG_XMM0) & 0xFFFFFFFF
            angle, = struct.unpack("<f", struct.pack("<I", bits))
            engine.reg_write(reg.UC_X86_REG_XMM0, int.from_bytes(
                struct.pack("<ff", math.sin(angle), math.cos(angle)), "little",
            ))
        elif rva == 0x14BC630:
            rng_samples.append(supplied_random)
            engine.reg_write(reg.UC_X86_REG_XMM0, struct.unpack(
                "<I", struct.pack("<f", supplied_random),
            )[0])
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
        target, = struct.unpack("<Q", engine.mem_read(rsp, 8))
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
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary,
                    begin=image.base + rva, end=image.base + rva)
        for rva in (0x14A0300, 0x14A2030, 0x2051310, 0x2050F6E)
    ]
    call(0x14D501F, definition, end=image.base + 0x14D523E)
    call(0x17BDC20, definition)
    for hook in hooks:
        vm.hook_del(hook)
    call(0x17D6740, primitive)
    primitive_vtable, = struct.unpack("<Q", vm.mem_read(primitive, 8))
    if primitive_vtable != image.base + 0x2465278:
        raise ValueError("Unexpected native ArbitraryQuad vtable")
    capacity, = struct.unpack("<Q", vm.mem_read(primitive_vtable + 0x38, 8))
    if capacity != image.base + 0x179CC50:
        raise ValueError("Unexpected native ArbitraryQuad capacity callback")
    writer, = struct.unpack("<Q", vm.mem_read(primitive_vtable + 0x28, 8))
    if writer != image.base + 0x175B1F0:
        raise ValueError("Unexpected native ArbitraryQuad writer")
    period_bits, = struct.unpack("<I", vm.mem_read(definition + 0x224, 4))
    if period_bits != 0x7F7FFFFF:
        raise ValueError("Unexpected native emitter period")

    put(definition + 0x1f0, "f", authored["rate"])
    flags, = struct.unpack("<I", vm.mem_read(definition + 0x2d0, 4))
    put(definition + 0x2d0, "I", flags | 0x100000)
    put(definition + 0x60, "Q", primitive)
    put(actor, "QQ", system, link)
    put(link + 0x10, "Q", definition)
    put(image.base + 0x24E8660, "Q", quality)
    put(quality + 0x284, "6f", *([1] * 6))

    cases = []
    for elapsed in (0, 0.033, 0.1, 0.667):
        put(context + 0x18, "ff", elapsed, elapsed / authored["lifetime"])
        for already_born in (False, True):
            put(actor + 0x18, "B", 4 if already_born else 0)
            count = call(0x1786A10, actor, context)
            if count != (0 if already_born else 1):
                raise ValueError("Unexpected original single-particle count")
            cases.append({"suppliedElapsedSeconds": elapsed, "alreadyBorn": already_born, "count": count})

    resource, resource_settings, pool, attachment = (
        stop + offset for offset in (0x7100, 0x7300, 0x7500, 0x7700)
    )
    put(link + 8, "Q", resource)
    put(resource + 0x38, "Q", resource_settings)
    put(link + 0x1c, "i", -1)
    put(link + 0x30, "i", -1)
    put(link + 0xe0, "ii", -1, -1)
    put(actor + 0x20, "f", authored["lifetime"])
    put(actor + 0x38, "Q", attachment)
    put(actor + 0xA0, "Q", pool)
    # Owned empty pool and its emitter, enclosing actor, and resource links.
    put(pool + 0xd8, "QQ", link, actor)
    put(system + 0x1e8, "Q", resource)
    put(resource_settings + 0x38, "Q", pool + 0x100)
    call(0x14B4E00, system + 0x248)
    # Typed registrations bind these constants at 0x1727dc1–0x1728753.
    put(definition + 0x240, "3f", *authored["EmitterPosition"])
    put(definition + 0xf8, "f", authored["particleLifetime"])
    put(definition + 0x118, "f", authored["particleLinger"])
    put(definition + 0x3a0, "f", authored["bindWeight"])
    put(definition + 0x388, "4f", *authored["color"])
    put(definition + 0x3d0, "3f", *authored["birthRotation0"])
    put(definition + 0x3e8, "3f", *authored["birthScale0"])
    put(definition + 0x14, "B", authored["blendMode"])
    put(definition + 0x70, "h", authored["pass"])
    put(definition + 0x72, "B", authored["miscRenderFlags"])
    put(definition + 0x2d0, "I", flags | 0x100000 | 0x100)
    put(system + 0x150, "2f", 1, 1)
    put(system + 0x1b0, "8f", *([1] * 8))
    # The outer update copies this separate system alpha into its context.
    put(system + 0x1d0, "f", 1)
    put(system + 0x1f0, "2f", 1, 1)
    previous_clock_marker = bytes(image.image[0x2140974:0x2140978])

    def capture_birth(engine, _address, _size, _data):
        clock_context = engine.reg_read(reg.UC_X86_REG_RSI)
        position = struct.unpack("<3f", engine.mem_read(clock_context, 12))
        clock, = struct.unpack("<f", engine.mem_read(clock_context + 0x18, 4))
        count = engine.reg_read(reg.UC_X86_REG_EDX)
        if position != tuple(authored["EmitterPosition"]) or clock != 0 or count != 1:
            raise ValueError("Original emitter birth boundary changed")
        updates.append({
            "entry": 0x1786280,
            "birthEntry": 0x1786E00,
            "suppliedElapsedSeconds": 0,
            "birthClockSeconds": clock,
            "birthCount": count,
            "emitterPositionInput": position,
        })

    birth_entry = image.base + 0x1786E00
    insertion_entry = image.base + 0x1789DF0
    vm.hook_add(unicorn.UC_HOOK_CODE, capture_birth, begin=birth_entry, end=birth_entry)
    for rva in (0x2050D8E, 0x2050B90, 0x14BC630, 0x14C5B20, 0x14C5B80):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary,
                    begin=image.base + rva, end=image.base + rva)

    initial_actor = bytes(vm.mem_read(actor, 0x140))
    view, draw, geometry, indices, vertices = (
        stop + n for n in (0xA000, 0xA100, 0xA200, 0xA300, 0xA400)
    )
    # The original packed writer references the macOS stack guard.
    put(image.base + 0x24DC310, "Q", view + 0x88)

    def write_quad(expected_count):
        vm.mem_write(view, bytes(0x1000))
        put(geometry, "5Q", indices, vertices, draw, actor, view)
        put(view, "3f", 0, 1000, 0)
        put(view + 0x24, "3f", 0, -1, 0)
        call(writer - image.base, primitive, geometry)
        index_end, vertex_end = struct.unpack("<2Q", vm.mem_read(geometry, 16))
        if (index_end - indices, vertex_end - vertices) != (12 * expected_count, 112 * expected_count):
            raise ValueError("Original ArbitraryQuad buffer advances differ")
        if not expected_count:
            return None
        index_bytes = bytes(vm.mem_read(indices, 12))
        vertex_bytes = bytes(vm.mem_read(vertices, 112))
        triangle_indices = struct.unpack("<6H", index_bytes)
        corners = list(struct.iter_unpack("<3f4B6e", vertex_bytes))
        positions = [corner[:3] for corner in corners]
        expected_positions = [(200, 90, 0), (-200, 90, 0), (-200, -150, 0), (200, -150, 0)]
        if triangle_indices != (0, 1, 2, 0, 2, 3) or not all(
            abs(value - expected) < 0.0001
            for corner, expected_corner in zip(positions, expected_positions)
            for value, expected in zip(corner, expected_corner)
        ):
            raise ValueError("Original ArbitraryQuad indices or corners differ")
        base_uvs = [corner[7:9] for corner in corners]
        if base_uvs != [(0, 0), (1, 0), (1, 1), (0, 1)]:
            raise ValueError("Original ArbitraryQuad base UVs differ")
        return {
            "indicesHex": index_bytes.hex(),
            "verticesHex": vertex_bytes.hex(),
            "indices": triangle_indices,
            "positions": positions,
            "baseUvs": base_uvs,
            "packedColorBytes": [corner[3:7] for corner in corners],
            "secondUv": [corner[9:11] for corner in corners],
            "finalHalfPair": [corner[11:13] for corner in corners],
        }

    def capture_insertion(_engine, _address, _size, _data):
        output = bytes(vm.mem_read(vm.reg_read(reg.UC_X86_REG_RSI), 0xDC))
        if vm.reg_read(reg.UC_X86_REG_RDI) != pool or rng_samples != [supplied_random]:
            raise ValueError("Unexpected native insertion context")
        observed = {
            "position": struct.unpack_from("<3f", output, 0x50),
            "rotation": struct.unpack_from("<3f", output, 0x5C),
            "scale": struct.unpack_from("<3f", output, 0x68),
            "lifetimeSeconds": struct.unpack_from("<f", output, 0xCC)[0],
            "baseUvPayload": bool(vm.reg_read(reg.UC_X86_REG_RDX)),
            "multUvPayload": bool(vm.reg_read(reg.UC_X86_REG_RCX)),
        }
        expected = {
            "position": tuple(authored["EmitterPosition"]),
            "rotation": tuple(authored["birthRotation0"]),
            "scale": tuple(authored["birthScale0"]),
            "lifetimeSeconds": authored["particleLifetime"],
            "baseUvPayload": False,
            "multUvPayload": False,
        }
        if observed != expected:
            raise ValueError(f"Original particle insertion input differs: {observed}")
        insertion_cases.append({"suppliedRandomSample": supplied_random, **observed})

    vm.hook_add(unicorn.UC_HOOK_CODE, capture_insertion, begin=insertion_entry, end=insertion_entry)
    updates, insertion_cases, quads, retained_controls = [], [], [], []
    initial_heap = heap
    next_time = 1 / 60
    for supplied_random in (0.125, 0.875):
        rng_samples = []
        heap = initial_heap
        vm.mem_write(heap, bytes(stop + 0xA000 - heap))
        vm.mem_write(pool, bytes(0xd8))
        vm.mem_write(actor, initial_actor)
        vm.mem_write(actor + 0x24, previous_clock_marker)
        put(actor + 0x18, "B", 0)
        write_quad(0)
        vm.mem_write(stop + 0xD000, bytes(stack - (stop + 0xD000)))
        call(0x1786280, actor, time=0)
        call(0x1786280, actor, time=next_time)
        count, = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))
        if count != 1 or rng_samples != [supplied_random]:
            raise ValueError("Original update did not retain exactly one particle")
        quad = write_quad(count)
        if quad["packedColorBytes"] != [(182, 93, 73, 140)] * 4:
            raise ValueError("Original packed color differs under supplied unit system alpha")
        call(0x1786280, actor, time=next_time)
        if write_quad(count) != quad:
            raise ValueError("Non-advancing clock changed the original particle quad")
        retained_time = 4.1
        call(0x1786280, actor, time=retained_time)
        retained = write_quad(count)
        if retained["packedColorBytes"] != quad["packedColorBytes"]:
            raise ValueError("Original retained particle alpha changed unexpectedly")
        expiry_time = 5.25
        call(0x1786280, actor, time=expiry_time)
        expired_count, = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))
        if expired_count != 0:
            raise ValueError("Original particle pool remained populated at expiry control")
        write_quad(expired_count)
        retained_controls.append({"retainedClockSeconds": retained_time,
                                  "packedColorBytes": retained["packedColorBytes"],
                                  "expiryClockSeconds": expiry_time,
                                  "expiredParticlesRemaining": expired_count,
                                  "expiredIndexCount": 0})
        quads.append(quad)
    if len(insertion_cases) != 2 or len(updates) != 2 or updates[0] != updates[1]:
        raise ValueError("Original outer update did not reach one birth per control")
    if quads[0] != quads[1] or retained_controls[0] != retained_controls[1]:
        raise ValueError("Supplied random samples changed original packed quad output")

    texture_controls = []
    sampler_entry = image.base + 0x170D330
    name_interner = image.base + 0x14C53D0
    bind_entry = image.base + 0x170D481
    sampler_frame = stack - 0x100
    string_storage = stop + 0xB000
    for field, slot, definition_offset, caller in (
        ("texture", 0, 0x98, 0x1708E28),
        ("particleColorTexture", 1, 0xA8, 0x17089A1),
    ):
        name = authored[field].encode("ascii") + b"\0"
        vm.mem_write(string_storage, name)
        put(definition + definition_offset, "QII", string_storage, len(name) - 1, len(name))
        put(stack, "Q", stop)
        vm.reg_write(reg.UC_X86_REG_RSP, stack)
        vm.reg_write(reg.UC_X86_REG_RBP, sampler_frame)
        vm.reg_write(reg.UC_X86_REG_RBX, link)
        vm.emu_start(image.base + caller, name_interner, count=16)
        address = vm.reg_read(reg.UC_X86_REG_RDI)
        if vm.reg_read(reg.UC_X86_REG_RIP) != name_interner or address != definition + definition_offset:
            raise ValueError("Original material caller did not select the authored texture field")
        pointer, length, _capacity = struct.unpack("<QII", vm.mem_read(address, 16))
        if bytes(vm.mem_read(pointer, length + 1)) != name:
            raise ValueError("Original material caller did not read the reviewed texture name")
        # Observe the instructions after native name interning and before
        # acquisition. The token is deliberately opaque and never looked up.
        return_rva, = struct.unpack("<Q", vm.mem_read(vm.reg_read(reg.UC_X86_REG_RSP), 8))
        vm.reg_write(reg.UC_X86_REG_RSP, stack)
        vm.reg_write(reg.UC_X86_REG_RAX, 0x1234)
        vm.ctl_remove_cache(sampler_entry, bind_entry)
        vm.emu_start(return_rva, sampler_entry, count=16)
        token_box = vm.reg_read(reg.UC_X86_REG_RDX)
        if (vm.reg_read(reg.UC_X86_REG_RIP) != sampler_entry or
            vm.reg_read(reg.UC_X86_REG_RCX) != slot or
            vm.reg_read(reg.UC_X86_REG_RDI) != link or
            bytes(vm.mem_read(token_box, 8)) != struct.pack("<Q", 0x1234)):
            raise ValueError(
                f"Original sampler caller did not forward {field}/{slot}: "
                f"RIP={vm.reg_read(reg.UC_X86_REG_RIP):#x}, "
                f"RCX={vm.reg_read(reg.UC_X86_REG_RCX):#x}, "
                f"RDI={vm.reg_read(reg.UC_X86_REG_RDI):#x}, RDX={token_box:#x}"
            )
        vm.emu_start(sampler_entry, bind_entry, count=500)
        if vm.reg_read(reg.UC_X86_REG_RIP) != bind_entry:
            raise ValueError("Original sampler did not reach the resource/cache boundary")
        frame = vm.reg_read(reg.UC_X86_REG_RBP)
        raw = bytes(vm.mem_read(frame - 0x40, 5))
        expected = bytes([0, 0, 0, 1, 1] if slot == 0 else [1, 1, 1, 1, 1])
        if raw != expected:
            raise ValueError(f"Original sampler descriptor differs for {field}: {raw.hex()}")
        semantic, = struct.unpack("<Q", vm.mem_read(image.base + 0x2462750 + 8 * slot, 8))
        expected_name = b"TEXTURE\0" if slot == 0 else b"PARTICLE_COLOR_TEXTURE\0"
        if bytes(vm.mem_read(semantic, len(expected_name))) != expected_name:
            raise ValueError("Original particle sampler semantic table differs")
        texture_controls.append({
            "authoredField": field, "authoredPath": authored[field],
            "semantic": expected_name[:-1].decode("ascii"), "slot": slot,
            "callerEntry": caller, "descriptorPrefixHex": raw.hex(),
        })

    for rva in (0x2051310, 0x2050F6E, 0x14A2030):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary,
                    begin=image.base + rva, end=image.base + rva)
    shader_selector = 0x1709BA0
    shader_request = 0x170CDC0
    pass_selector = 0x1709A00
    passes = [variant for variant in range(7) if call(pass_selector, link, rsi=variant) & 0xFF]
    if passes != [4]:
        raise ValueError(f"Original material pass selection differs: {passes}")
    pass_variant, = passes
    call(shader_selector, link, rsi=pass_variant, end=image.base + shader_request)

    def selected_stage(register):
        wrapper = vm.reg_read(register)
        pointer, length, capacity = struct.unpack("<QII", vm.mem_read(wrapper, 16))
        if not 0 < length < capacity <= 0x100 or not stack - 0x1000 <= pointer < stack:
            raise ValueError("Original shader stage string outside owned stack")
        return bytes(vm.mem_read(pointer, length)).decode("ascii")

    pixel_stage = selected_stage(reg.UC_X86_REG_RSI)
    vertex_stage = selected_stage(reg.UC_X86_REG_RDX)
    if (pixel_stage, vertex_stage) != ("ParticleSystem/QUAD_PS.ps", "ParticleSystem/QUAD_VS.vs"):
        raise ValueError("Original CPU shader stage selection differs")
    defines = vm.reg_read(reg.UC_X86_REG_RCX)
    define_count, = struct.unpack("<I", vm.mem_read(defines + 8, 4))
    if define_count != 0:
        raise ValueError("Original shader request added authored define rows")
    # The original finalizer tests request byte +4 at 0x170ce25
    # before appending PALETTIZE_TEXTURES at 0x170d1db.
    shader_request_flags = bytes(vm.mem_read(vm.reg_read(reg.UC_X86_REG_R9), 10))
    if any(shader_request_flags):
        raise ValueError("Original shader finalizer flags differ for the supplied context")

    material_parameters = []
    for rva in (0x1959670, 0x17F3EC0):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary,
                    begin=image.base + rva, end=image.base + rva)
    descriptor_start, descriptor_end = (0x1708ED0, 0x1708E7A)
    frame = stack - 0x40
    vm.mem_write(frame - 0x200, bytes(0x200))
    put(frame - 0x184, "I", vm.mem_read(primitive + 8, 1)[0])
    put(view, "B", pass_variant)
    for register, address in (
        (reg.UC_X86_REG_RBP, frame), (reg.UC_X86_REG_RSP, frame - 0x220),
        (reg.UC_X86_REG_RBX, link), (reg.UC_X86_REG_R12, frame - 0x17C),
        (reg.UC_X86_REG_R13, draw), (reg.UC_X86_REG_R14, view),
        (reg.UC_X86_REG_R15, 0),
    ):
        vm.reg_write(register, address)
    vm.emu_start(image.base + descriptor_start, image.base + descriptor_end, count=500)
    if vm.reg_read(reg.UC_X86_REG_RIP) != image.base + descriptor_end:
        raise ValueError("Original render-state descriptor did not reach its setter")
    descriptor = bytes(vm.mem_read(frame - 0x180, 32))
    if descriptor.hex() != "3f0000000403000000000606070700010f000000000000000000000000000000":
        raise ValueError(f"Original render-state descriptor differs: {descriptor.hex()}")
    threshold, = struct.unpack("<f", struct.pack("<f", 5 / 255))
    if material_parameters != [("ALPHA_TEST", 1), ("AlphaTestReferenceValue", (threshold, 0, 0, 0))]:
        raise ValueError("Original material did not request its alpha threshold")
    blend_table = struct.unpack_from("<11Q", image.image, 0x2158E50)
    if tuple(blend_table[index] for index in descriptor[10:14]) != (4, 4, 5, 5):
        raise ValueError("Original Metal blend-factor mapping differs")

    print(json.dumps({
        "nativeCountEntry": 0x1786A10,
        "arbitraryQuadCapacityEntry": capacity - image.base,
        "nativePeriodBits": period_bits,
        "suppliedQualityScale": 1,
        "cases": cases,
        "outerUpdate": updates[0],
        "particleInsertionBoundary": {
            "entry": insertion_entry - image.base,
            "scope": "Fresh component at the origin with supplied unit scales and random samples.",
            "cases": insertion_cases,
        },
        "cpuQuad": {
            "writerEntry": writer - image.base,
            "suppliedSystemBasis": "identity",
            "suppliedSystemAlpha": 1,
            "suppliedViewPosition": [0, 1000, 0],
            "suppliedNextUpdateSeconds": next_time,
            "emptyPoolIndices": 0,
            "retainedParticles": count,
            "sameClockQuadUnchanged": True,
            "lifetimeControl": retained_controls[0],
            "vertexStrideBytes": 28,
            "vertexOffsets": {"positionFloat32x3": 0, "packedColorBytes": 12, "baseUvFloat16x2": 16,
                              "secondUvFloat16x2": 20, "finalFloat16x2": 24},
            "scope": "Original CPU pool insertion, following update and packed quad writer. Supplied scene basis, quality, time, random samples and view. Replay attachment, shader/samplers and GPU submission remain unobserved.",
            **quads[0],
        },
        "cpuMaterial": {
            "shaderRequest": {
                "selectorEntry": shader_selector,
                "requestBoundary": shader_request,
                "passSelector": pass_selector,
                "selectedPassVariant": pass_variant,
                "pixelStage": pixel_stage,
                "vertexStage": vertex_stage,
                "additionalDefineRows": define_count,
                "finalizerFlagsHex": shader_request_flags.hex(),
                "palettizeTexturesFlagOffset": 4,
            },
            "renderStateRequest": {
                "descriptorStart": descriptor_start,
                "descriptorSetterBoundary": descriptor_end,
                "descriptorHex": descriptor.hex(),
                "depthTest": False, "depthWrite": False,
                "colorWriteMask": [True, True, True, True],
                "cullEnabled": False, "stencilEnabled": False,
                "metalBlendFactors": {"sourceRGB": 4, "sourceAlpha": 4,
                                      "destinationRGB": 5, "destinationAlpha": 5},
                "blendOperation": "add",
                "materialParameterRequests": material_parameters,
            },
            "samplerBuilder": sampler_entry - image.base,
            "resourceBindingBoundary": bind_entry - image.base,
            "textureControls": texture_controls,
            "scope": "Original CPU texture field/slot selection, sampler prefix, shader stage request and render descriptor under supplied graphics context. Shader permutations, resource acquisition, device bindings and framebuffer remain unobserved.",
        },
    }, allow_nan=False))


if __name__ == "__main__":
    main()
