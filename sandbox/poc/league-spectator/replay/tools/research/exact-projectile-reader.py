"""Observe reviewed League missile packet readers and descriptors in Unicorn."""

import hashlib
import json
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
    build = sys.argv[2] if len(sys.argv) > 2 else "16.23.840.6595"
    reviewed_digests = {
        "16.23.840.6595": "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15",
        "16.23.841.8428": "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7",
    }
    if digest != reviewed_digests.get(build):
        raise ValueError(f"Expected reviewed exact {build} executable bytes")
    image = MachImage(binary)
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    stop, obj, cursor, body, guard = (0x10000000, 0x10000100, 0x10000400, 0x10001000, 0x10002000)
    empty_pool, descriptor, frame = (0x10003000, 0x10004000, 0x10006500)
    stack, heap_start, arena_end = (0x1000F008, 0x10010000, 0x10100000)
    vm.mem_map(stop, arena_end - stop)
    for rva, name in image.data_imports.items():
        if name == "___stack_chk_guard":
            vm.mem_write(image.base + rva, struct.pack("<Q", guard))

    context = 0
    heap = heap_start
    source_names = []
    entity_keys = []
    spell_keys = []
    component_vectors = []
    component_activations = []
    terrain_probe_height = None
    collision_probe = None

    def call(entry, rdi=0, rsi=0, rdx=0, rbp=0, end=stop, rcx=0):
        vm.mem_write(stack, struct.pack("<Q", stop))
        for register, value in [
            (reg.UC_X86_REG_RDI, rdi),
            (reg.UC_X86_REG_RSI, rsi),
            (reg.UC_X86_REG_RDX, rdx),
            (reg.UC_X86_REG_RCX, rcx),
            (reg.UC_X86_REG_RSP, stack),
            (reg.UC_X86_REG_RBP, rbp),
        ]:
            vm.reg_write(register, value)
        vm.emu_start(image.base + entry, end, count=400000)
        if vm.reg_read(reg.UC_X86_REG_RIP) != end:
            raise ValueError(f"Instruction bound exceeded at {entry:#x}")

    def modeled_boundary(engine, address, _size, _data):
        nonlocal heap
        rva = address - image.base
        name = image.imports.get(rva)
        if rva == 0x1637CB0:
            # The ROFL envelope supplied this context outside the archived body.
            packet_object = engine.reg_read(reg.UC_X86_REG_RDI)
            engine.mem_write(packet_object + 12, struct.pack("<I", context))
            returned = 1
        elif rva in (0x14A0300, 0x14A2030, 0x14C5B20) or name == "_malloc":
            length = engine.reg_read(reg.UC_X86_REG_RDI)
            returned = heap
            heap += max(32, (length + 31) & ~31)
            if heap > arena_end:
                raise ValueError("Packet allocation escaped scratch arena")
        elif name == "__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6assignEPKc":
            destination = engine.reg_read(reg.UC_X86_REG_RDI)
            source = engine.reg_read(reg.UC_X86_REG_RSI)
            data = bytes(engine.mem_read(source, 23))
            length = data.find(b"\0")
            if length < 0:
                raise ValueError("Expected short native source identifier")
            source_names.append(data[:length].decode("ascii"))
            engine.mem_write(destination, bytes([length * 2]) + data[:length] + bytes(23 - length))
            returned = destination
        elif rva == 0x863D80:
            # Capture the input to the native spell registry query and report a
            # miss. This is evidence of the requested spell, without live lookup.
            spell_keys.append(engine.reg_read(reg.UC_X86_REG_ESI))
            returned = 0
        elif rva in (0x5564C0, 0x558890):
            entity_keys.append(engine.reg_read(reg.UC_X86_REG_ESI))
            returned = 0
        elif rva == 0x874A60:
            returned = empty_pool
        elif rva == 0x87CCC0 and collision_probe is None:
            argument = engine.reg_read(reg.UC_X86_REG_RSI)
            component_vectors.append(struct.unpack("<I3f", engine.mem_read(argument, 16)))
            returned = 0
        elif rva == 0x899A10 and collision_probe is not None:
            collision_probe["companionDispatches"] += 1
            return
        elif rva == 0x88F270 and collision_probe is not None:
            state = engine.reg_read(reg.UC_X86_REG_RSI)
            argument = struct.unpack("<Q", engine.mem_read(state + 0x10, 8))[0]
            collision_probe["childArguments"].append(struct.unpack("<I3f", engine.mem_read(argument, 16)))
            # Stop before the child consumes the live missile velocity and
            # target object. Only activation of this child is demonstrated.
            returned = 0
        elif rva == 0x5587F0 and terrain_probe_height is not None:
            # Forced recorded-source placement takes its XYZ from the packet
            # even with no caster object. Do not provide a modeled caster pose.
            returned = 0
        elif rva == 0x16DEAC0 and terrain_probe_height is not None:
            # Control the terrain query to verify that ground-rebase changes
            # only the auxiliary height offset on this recorded-source branch.
            destination = engine.reg_read(reg.UC_X86_REG_RDI)
            engine.mem_write(destination, struct.pack("<f", terrain_probe_height))
            returned = 1
        elif rva == 0x14A0240 or name in ("_pthread_mutex_lock", "_pthread_mutex_unlock"):
            returned = 0
        elif build == "16.23.841.8428" and name == "___cxa_guard_acquire":
            address = engine.reg_read(reg.UC_X86_REG_RDI)
            returned = int(engine.mem_read(address, 1)[0] == 0)
        elif build == "16.23.841.8428" and name == "___cxa_guard_release":
            engine.mem_write(engine.reg_read(reg.UC_X86_REG_RDI), b"\x01")
            returned = 0
        elif build == "16.23.841.8428" and name == "___cxa_atexit":
            returned = 0
        elif name == "___bzero":
            destination = engine.reg_read(reg.UC_X86_REG_RDI)
            length = engine.reg_read(reg.UC_X86_REG_RSI)
            if length > arena_end - stop:
                raise ValueError("Zero fill escaped scratch arena")
            engine.mem_write(destination, bytes(length))
            returned = destination
        elif name == "_memmove" and collision_probe is not None:
            destination = engine.reg_read(reg.UC_X86_REG_RDI)
            source = engine.reg_read(reg.UC_X86_REG_RSI)
            length = engine.reg_read(reg.UC_X86_REG_RDX)
            if not all(stop <= address <= arena_end - length for address in (source, destination)):
                raise ValueError("Component copy escaped scratch arena")
            engine.mem_write(destination, bytes(engine.mem_read(source, length)))
            returned = destination
        else:
            if name is not None:
                raise ValueError(f"Unmodeled native import {name}")
            return
        pointer = engine.reg_read(reg.UC_X86_REG_RSP)
        engine.reg_write(reg.UC_X86_REG_RAX, returned)
        engine.reg_write(reg.UC_X86_REG_RIP, struct.unpack("<Q", engine.mem_read(pointer, 8))[0])
        engine.reg_write(reg.UC_X86_REG_RSP, pointer + 8)

    vm.hook_add(unicorn.UC_HOOK_CODE, modeled_boundary)
    inputs = json.load(sys.stdin)
    select_maokai_r = inputs.get("selectMaokaiR", False)
    if select_maokai_r and build != "16.23.841.8428":
        raise ValueError("Maokai R discovery requires the reviewed .8428 decoder")
    unsupported_launches = []
    unresolved_descriptors = []
    results = []
    for creation_index, (context, hex_payload) in enumerate(inputs["creation"]):
        payload = bytes.fromhex(hex_payload)
        if not 1 <= len(payload) <= 1024:
            raise ValueError("Invalid missile body length")
        vm.mem_write(stop, bytes(arena_end - stop))
        heap = heap_start
        source_names.clear()
        entity_keys.clear()
        spell_keys.clear()
        call(0x108F060, obj)
        vm.mem_write(cursor, struct.pack("<Q", body))
        vm.mem_write(body, payload)
        call(0x1321380, obj, cursor, body + len(payload))
        consumed = struct.unpack("<Q", vm.mem_read(cursor, 8))[0] - body
        if vm.reg_read(reg.UC_X86_REG_AL) != 1 or consumed != len(payload):
            raise ValueError(f"Native missile reader rejected body for {context}")
        call(0x845240, descriptor)
        try:
            call(0x842310, descriptor, obj + 0x58)
        except unicorn.UcError as error:
            instruction = vm.reg_read(reg.UC_X86_REG_RIP) - image.base
            if select_maokai_r and instruction == 0x557B67:
                unresolved_descriptors.append({"entity": context, "creationIndex": creation_index})
                continue
            raise ValueError(
                f"Native descriptor boundary for {context} at {instruction:#x}; "
                f"source name count {len(source_names)}, spell key count {len(spell_keys)}"
            ) from error
        raw = vm.mem_read(descriptor, 0x190)
        if select_maokai_r and ("Maokai" not in source_names or 0x0187CC63 not in spell_keys):
            continue
        if len(entity_keys) != 2 or entity_keys[0] != entity_keys[1] or len(source_names) != 1 or len(spell_keys) != 1:
            raise ValueError(f"Ambiguous native missile identity for {context}")
        entity_id = struct.unpack_from("<I", raw, 0x9C)[0]
        if entity_id != context:
            raise ValueError(f"Missile body and envelope disagree for {context}")

        # Original dispatch checks whether it will supply a distinct placement
        # pointer. The audited packets take the null-pointer branch. We do not
        # replace the scene/terrain lookup or supply artificial world positions.
        vm.reg_write(reg.UC_X86_REG_R15, obj)
        call(0x6E587E, rbp=frame, end=image.base + 0x6E58EA)
        if vm.reg_read(reg.UC_X86_REG_RCX):
            if select_maokai_r:
                unsupported_launches.append([context, "separate-placement-override"])
                continue
            raise ValueError(f"Separate placement override belongs to {context}")

        vm.reg_write(reg.UC_X86_REG_R13, obj)
        call(0x8920E2, end=image.base + 0x892132)
        (elapsed_seconds,) = struct.unpack("<f", struct.pack("<I", vm.reg_read(reg.UC_X86_REG_EAX)))
        forced_source = raw[0x158]
        if forced_source != 1:
            if select_maokai_r:
                unsupported_launches.append([context, "caster-relative-placement"])
                continue
            raise ValueError(f"Expected recorded-source placement for {context}")
        start_xyz = struct.unpack_from("<3f", raw, 0xD0)
        start, local_offset = descriptor + 0x300, descriptor + 0x340
        native_starts = []
        for ground_rebase, terrain_probe_height in [(0, 0.0), (1, 0.0), (1, 64.0)]:
            # Use the native constructor's zeroed height fields and both plane
            # flag outcomes. The caller separately binds the authored offset.
            vm.mem_write(start, bytes(0x14) + bytes([ground_rebase]) + bytes(0x13))
            vm.mem_write(local_offset, bytes(12))
            call(0x88DA10, start, descriptor, rcx=local_offset)
            position = struct.unpack("<3f", vm.mem_read(start, 12))
            if position != start_xyz:
                raise ValueError(f"Original recorded-source branch changed XYZ for {context}")
            (height_offset,) = struct.unpack("<f", vm.mem_read(start + 0xC, 4))
            native_starts.append(
                {
                    "groundRebase": bool(ground_rebase),
                    "terrainControlHeight": terrain_probe_height,
                    "positionXYZ": position,
                    "planeHeightOffset": height_offset,
                }
            )
        terrain_probe_height = None

        results.append(
            {
                "entity": entity_id,
                "sourceName": source_names[0],
                "sourceContext": entity_keys[0],
                "requestedMissileSpellHash": spell_keys[0],
                "castHash": struct.unpack_from("<I", raw, 0x14)[0],
                "castSourceXYZ": start_xyz,
                "castTargetXYZ": struct.unpack_from("<3f", raw, 0xDC),
                "forcedRecordedSource": bool(forced_source),
                "packetElapsedSeconds": elapsed_seconds,
                "nativeRecordedSourceStarts": native_starts,
                "bodyBytes": consumed,
                **({"creationIndex": creation_index} if select_maokai_r else {}),
            }
        )
    controller_vectors = []
    for hex_payload in inputs["controller"]:
        payload = bytes.fromhex(hex_payload)
        if len(payload) != 13 or payload[0] & 8:
            raise ValueError("Expected a full opcode-337 controller vector")
        vm.mem_write(obj, b"\0" * 12)
        vm.mem_write(cursor, struct.pack("<Q", body))
        vm.mem_write(body, payload)
        # Opcode 337's reader admits this lane at +0x10 when flag bit 3 is
        # clear. Invoke its original three-scalar reader on the admitted lane.
        vm.mem_write(cursor, struct.pack("<Q", body + 1))
        call(0x13D4500, obj, cursor, body + len(payload))
        consumed = struct.unpack("<Q", vm.mem_read(cursor, 8))[0] - body
        if vm.reg_read(reg.UC_X86_REG_AL) != 1 or consumed != len(payload):
            raise ValueError("Native controller-vector reader did not consume the body")
        controller_vectors.append(struct.unpack("<3f", vm.mem_read(obj, 12)))
    for context, hex_payload in inputs["components"]:
        payload = bytes.fromhex(hex_payload)
        if len(payload) != 18:
            raise ValueError("Expected reviewed opcode-784 component body")
        vm.mem_write(stop, bytes(arena_end - stop))
        heap = heap_start
        # Run the original packet-factory case. It writes its result to RBX.
        vm.reg_write(reg.UC_X86_REG_RBX, obj)
        call(0x1012D72, end=image.base + 0x101C304)
        packet_object = struct.unpack("<Q", vm.mem_read(obj, 8))[0]
        vm.mem_write(cursor, struct.pack("<Q", body))
        vm.mem_write(body, payload)
        call(0x13267A0, packet_object, cursor, body + len(payload))
        consumed = struct.unpack("<Q", vm.mem_read(cursor, 8))[0] - body
        packet_context = struct.unpack("<I", vm.mem_read(packet_object + 12, 4))[0]
        if vm.reg_read(reg.UC_X86_REG_AL) != 1 or consumed != len(payload) or packet_context != context:
            raise ValueError(f"Native component reader rejected body for {context}")
        before = len(component_vectors)
        call(0x8936F0, descriptor, packet_object)
        if vm.reg_read(reg.UC_X86_REG_AL) != 1 or len(component_vectors) != before + 1:
            raise ValueError("Expected a single original missile component dispatch")
        record = next(row for row in results if row["entity"] == context)
        if record["sourceName"] == "Zoe":
            # Stage the two authored component objects using their original
            # default constructors and factories. A bounded backing store
            # supplies only vector capacity to the missile.
            missile, staged, active, event_argument, handled = (
                0x10007000,
                0x10007800,
                0x10007900,
                0x10007A00,
                0x10007B00,
            )
            vm.mem_write(missile + 0x3C0, struct.pack("<3Q", active, active, active + 32))
            vm.mem_write(missile + 0x3E0, struct.pack("<3Q", staged, staged, staged + 32))
            for constructor, factory in [(0x889070, 0x880C10), (0x888F70, 0x880A40)]:
                call(constructor)
                call(factory, vm.reg_read(reg.UC_X86_REG_RAX), missile)
            original_argument = component_vectors[-1]
            vm.mem_write(event_argument, struct.pack("<I3f", *original_argument))
            collision_probe = {"companionDispatches": 0, "childArguments": []}
            call(0x87CCC0, missile, event_argument, handled)
            if (
                collision_probe["companionDispatches"] != 1
                or collision_probe["childArguments"] != [original_argument]
                or vm.mem_read(handled, 1) != b"\x01"
            ):
                raise ValueError(f"Authored missile components did not dispatch for {context}")
            component_activations.append({"entity": context, **collision_probe})
            collision_probe = None
    print(
        json.dumps(
            {
                "decoderSha256": digest,
                "records": results,
                **(
                    {
                        "unsupportedMaokaiLaunches": unsupported_launches,
                        "unresolvedDescriptors": unresolved_descriptors,
                    }
                    if select_maokai_r
                    else {}
                ),
                "controllerVectors": controller_vectors,
                "componentVectors": component_vectors,
                "componentActivations": component_activations,
            },
            allow_nan=False,
        )
    )


if __name__ == "__main__":
    main()
