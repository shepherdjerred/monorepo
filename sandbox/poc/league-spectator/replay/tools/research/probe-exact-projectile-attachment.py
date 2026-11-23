"""Verify saved Zoe recast effect requests and controlled original orientation."""

import hashlib
import json
from pathlib import Path
import struct
import sys

import unicorn
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage


def main():
    executable, receipt_path, *ground_paths = map(Path, sys.argv[1:])
    if len(ground_paths) > 1:
        raise ValueError("Only one exact Map11 height receipt may be supplied")
    binary = executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    evidence = receipt_path.read_bytes()
    receipt = json.loads(evidence)
    if (
        digest != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
        or receipt["decoderSha256"] != digest
        or receipt["build"] != "16.23.840.6595"
        or receipt["protocol"] != "8bbfcd5af2bc92db"
        or receipt["replaySha256"] != "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b"
    ):
        raise ValueError("Expected the exact executable and admitted short replay receipt")
    (missile,) = (asset for asset in receipt["assets"] if asset["spell"] == "ZoeQMis2")
    effect = missile["effect"]
    effect_key = int(effect["propertyKey"], 16)
    if effect_key != 0x455F80A0 or effect["pathHash"] != "f8a40120" or effect["reviewedEmitter"]["index"] != 5:
        raise ValueError("Unexpected authored missile effect resolver link")
    if missile["recordedSourcePlacement"]["authoredEffectTurnOverridesPresent"]:
        raise ValueError("Authored Zoe recast turn overrides require a separate control")
    if (missile["movement"]["authoredGroundRebase"] is not True
            or missile["movement"]["authoredTrackTarget"] is not False):
        raise ValueError("Unexpected authored Zoe recast targeting flags")
    exact_ground, exact_plane_offsets, ground_receipt_digest = {}, {}, None
    if ground_paths:
        ground_data = ground_paths[0].read_bytes()
        ground = json.loads(ground_data)
        if (ground["build"] != receipt["build"] or ground["protocol"] != receipt["protocol"]
                or ground["replaySha256"] != receipt["replaySha256"]
                or ground["decoderSha256"] != digest
                or ground["sourceProjectileReceiptSha256"] != hashlib.sha256(evidence).hexdigest()
                or ground["map11"]["sha256"] != "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9"
                or ground["originalEntries"]["heightWrapper"] != 0x16DEAC0):
            raise ValueError("Map11 height receipt does not match the exact projectile inputs")
        exact_ground = {tuple(row["xz"]): row["height"] for row in ground["queries"] if row["inside"]}
        exact_plane_offsets = {row["entity"]: row["recordedSourcePlaneHeightOffset"]
                              for row in ground["events"]}
        if len(exact_ground) != 25 or set(exact_plane_offsets) != {1073742880, 1073743207}:
            raise ValueError("Exact Map11 receipt omitted required saved replay coordinates")
        ground_receipt_digest = hashlib.sha256(ground_data).hexdigest()

    image = MachImage(binary)
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    stop, stack = 0x10000000, 0x1000F008
    vm.mem_map(stop, 0x18000)
    (
        actor, callback, descriptor, owner, spell, mode, guard, weak,
        holder, particle_owner, vfx, movement, movement_spec,
    ) = [stop + offset for offset in range(0x1000, 0xE000, 0x1000)]
    packet, body, cursor, proposal, empty_allocator, placement, factory_type = [
        stop + offset for offset in range(0x11000, 0x18000, 0x1000)
    ]

    def put(address, layout, *values):
        vm.mem_write(address, struct.pack("<" + layout, *values))

    def read(address, layout):
        return struct.unpack("<" + layout, vm.mem_read(address, struct.calcsize("<" + layout)))

    def call(entry, rdi=0, rsi=0, rdx=0, end=stop):
        put(stack, "Q", stop)
        for register, value in (
            (r.UC_X86_REG_RDI, rdi), (r.UC_X86_REG_RSI, rsi), (r.UC_X86_REG_RDX, rdx),
            (r.UC_X86_REG_RSP, stack),
        ):
            vm.reg_write(register, value)
        vm.emu_start(image.base + entry, end, count=10000)
        pc = vm.reg_read(r.UC_X86_REG_RIP)
        if pc != end:
            raise ValueError(f"Native attachment entry {entry:#x} stopped at {pc - image.base:#x}")

    lookups, target_updates, spatial_notifications, movement_stop_requests = [], [], [], []
    removal_notifications = []
    active_entity = 0
    terrain_height = None
    terrain_queries = []

    def f32(value):
        return struct.unpack("<f", struct.pack("<f", value))[0]

    def xmm_float(register):
        return struct.unpack("<f", struct.pack("<I", vm.reg_read(register) & 0xFFFFFFFF))[0]

    def lookup_ground(point):
        return terrain_height[point] if isinstance(terrain_height, dict) else terrain_height

    def external(engine, address, _size, _user):
        rdi = engine.reg_read(r.UC_X86_REG_RDI)
        if address == image.base + 0x5587F0:
            lookups.append(engine.reg_read(r.UC_X86_REG_ESI))
            result = 0
        elif address == image.base + 0x2050A10 and rdi == weak:
            owners, = read(weak + 8, "Q")
            put(weak + 8, "Q", owners + 1)
            result = weak
        elif address == image.base + 0x1637CB0 and rdi == packet:
            put(packet + 12, "I", active_entity)
            result = 1
        elif address == image.base + 0x874A60:
            result = empty_allocator
        elif address == image.base + 0x842060 and rdi == actor + 0x1B0:
            target_updates.append(engine.reg_read(r.UC_X86_REG_ESI))
            result = 0
        elif address == image.base + 0x5568A0 and rdi == actor:
            spatial_notifications.append(read(actor + 0x160, "3f"))
            result = 0
        elif address == image.base + 0x8AF4D0 and rdi == movement_spec:
            movement_stop_requests.append(read(actor + 0x60, "3f"))
            result = 0
        elif address == image.base + 0x3C03A0 and rdi == actor:
            removal_notifications.append(engine.reg_read(r.UC_X86_REG_ESI))
            result = 0
        elif address == image.base + 0x16DEAC0 and terrain_height is not None:
            point = (xmm_float(r.UC_X86_REG_XMM0), xmm_float(r.UC_X86_REG_XMM1))
            height = lookup_ground(point)
            terrain_queries.append((point, height))
            put(rdi, "f", height)
            result = 1
        else:
            raise ValueError("Unexpected native replay attachment boundary")
        sp = engine.reg_read(r.UC_X86_REG_RSP)
        (target,) = read(sp, "Q")
        engine.reg_write(r.UC_X86_REG_RSP, sp + 8)
        engine.reg_write(r.UC_X86_REG_RAX, result)
        engine.reg_write(r.UC_X86_REG_RIP, target)

    for entry in (0x5587F0, 0x2050A10, 0x1637CB0, 0x874A60, 0x842060, 0x5568A0, 0x8AF4D0,
                  0x16DEAC0, 0x3C03A0):
        vm.hook_add(unicorn.UC_HOOK_CODE, external,
                    begin=image.base + entry, end=image.base + entry)
    put(image.base + 0x24E85B0, "Q", mode)
    put(image.base + 0x24DC310, "Q", guard)
    call(0x14D501F, end=image.base + 0x14D523E)

    mask = (1 << 64) - 1

    def ror(value, n):
        value &= mask
        return ((value >> n) | (value << (64 - n))) & mask

    # The exact consumer at 0x8ad3f4 and 0x8ad635 unwraps two typed
    # owner pointers. These wrappers reference only owned emulation objects.
    key, additive = 0x8403AC5D, 0xFFFFFFFF0087EA4F
    put(descriptor, "Q", ror(ror(owner ^ (key + 0x417BEE73), 47) ^ key, 11))
    inner = ((spell - additive - 0x7B746954) & mask) ^ 0x50B3152B
    inner = ((inner - additive) & mask) ^ (key + 0x11C8E39E)
    put(owner + 0x78, "Q", ((ror(inner, 16) ^ key) - additive) & mask)
    movement_vtable = 0x23CF2E0
    actor_vtable = 0x23CD410
    for table, slot, expected in [(movement_vtable, 0x38, 0x8A6BA0),
                                  (movement_vtable, 0xE8, 0x895FE0),
                                  (movement_vtable, 0x20, 0x8A1850),
                                  (actor_vtable, 0xA0, 0x5560D0),
                                  (actor_vtable, 0x1F0, 0x87CFB0)]:
        if read(image.base + table + slot, "Q") != (image.base + expected,):
            raise ValueError("Original missile or movement vtable changed")
    put(actor, "Q", image.base + actor_vtable)
    put(movement, "Q", image.base + movement_vtable)
    put(actor + 0x350, "Q", ror(ror(movement, 54) ^ (key + 0x11C8E39E), 13) ^ key)
    call(0x845240, actor + 0x1B0)

    def observe_requested_factory_target(event):
        frame = stack - 0x300
        put(descriptor + 0xDC, "3f", *event["castTargetXYZ"])
        put(factory_type, "Q", image.base + 0x23CFD38)
        put(empty_allocator + 0x110, "Q", factory_type)
        put(frame - 0xF0, "Q", empty_allocator + 0x100)
        for register, value in [(r.UC_X86_REG_R14, descriptor),
                                (r.UC_X86_REG_R15, empty_allocator + 0x100),
                                (r.UC_X86_REG_R12, actor),
                                (r.UC_X86_REG_RSP, frame - 0x210),
                                (r.UC_X86_REG_RBP, frame)]:
            vm.reg_write(register, value)
        vm.emu_start(image.base + 0x87D883, image.base + 0x87D8BF, count=64)
        target = vm.reg_read(r.UC_X86_REG_R9)
        if (vm.reg_read(r.UC_X86_REG_RIP) != image.base + 0x87D8BF
                or vm.reg_read(r.UC_X86_REG_R10) != image.base + 0x88CE80
                or target != descriptor + 0xDC):
            raise ValueError("Original factory call did not receive the recorded cast target")
        return read(target, "3f")

    def observe_spawn(event, candidate_key):
        lookups.clear()
        put(descriptor + 0x90, "I", event["sourceContext"])
        put(actor + 0x160, "3f", *event["verifiedBirthPositionXYZ"])
        put(spell + 0x3FC, "I", candidate_key)
        call(0x8AD390, callback, actor)
        call(0x8AD3F0, callback, actor + 0x160, descriptor, end=image.base + 0x8AD7D0)
        spawn = vm.reg_read(r.UC_X86_REG_R8)
        observed_key = vm.reg_read(r.UC_X86_REG_EDX)
        if spawn != actor + 0x160 or observed_key != candidate_key or lookups != [event["sourceContext"]]:
            raise ValueError("Original missile spawn request did not forward the reviewed identity")
        return {"nativeRequestedEffectHash": f"{observed_key:08x}", "spawnXYZ": read(spawn, "3f")}

    def observe_basis(destination):
        # The movement fragment begins after its original target-acquisition
        # call. Supply the target explicitly rather than treating opcode 337
        # target positions as live missile velocity.
        put(movement + 0x18, "Q", actor)
        put(movement + 0x7C, "3f", *destination)
        put(movement + 0xA0, "f", missile["movement"]["startingSpeed"])
        put(movement + 0xD8, "3f", *(missile["movement"][key] for key in (
            "acceleration", "minimumSpeed", "maximumSpeed",
        )))
        put(movement + 0xC0, "B", int(terrain_height is not None))
        put(movement + 0x94, "B", int(missile["movement"]["authoredTrackTarget"]))
        if terrain_height is not None:
            call(0x895F40, movement)
        else:
            vm.reg_write(r.UC_X86_REG_RBX, movement)
            # This bounded entry preserves the original routine's epilogue stack.
            put(stack - 0x18, "4Q", 0, 0, 0, stop)
            vm.reg_write(r.UC_X86_REG_RSP, stack - 0x18)
            vm.emu_start(image.base + 0x895F4F, stop, count=1000)
            if vm.reg_read(r.UC_X86_REG_RIP) != stop:
                raise ValueError("Original accelerating movement initialization did not return")
        velocity = read(actor + 0x60, "3f")

        update_basis()
        matrix = read(vfx + 0x128, "16f")
        direction = read(callback, "3f")
        return {"suppliedTargetXYZ": destination, "initialVelocityXYZ": velocity,
                "effectDirectionXYZ": direction, "effectBasis3x3": [
                    matrix[lane] for lane in range(12) if lane % 4 != 3
                ]}

    def update_basis():
        put(weak + 8, "Q", 1)
        put(callback + 0x10, "2Q", holder, weak)
        put(holder, "Q", particle_owner)
        put(particle_owner + 0x188, "Q", vfx)
        put(actor + 0x358, "Q", movement_spec)
        call(0x8AE780, callback, actor + 0x60)
        matrix = read(vfx + 0x128, "16f")
        if read(weak + 8, "Q") != (1,) or matrix[12:] != (0, 0, 0, 1):
            raise ValueError("Original callback did not preserve its owned object contract")
        return [matrix[lane] for lane in range(12) if lane % 4 != 3]

    def controller_trace(event, initial_target, subdivisions, supplied_terrain_height=None, plane_offset=32):
        nonlocal active_entity, terrain_height
        active_entity = event["entity"]
        put(actor + 0x3D8, "B", 0)
        observe_spawn(event, effect_key)
        terrain_height = supplied_terrain_height
        terrain_queries.clear()
        put(actor + 0x368, "Q", placement)
        put(placement + 0xC, "f", plane_offset)
        basis = observe_basis(initial_target)["effectBasis3x3"]
        previous_clock = event["creation"]["timeSeconds"]
        samples = [{"clock": previous_clock, "positionXYZ": read(actor + 0x160, "3f"),
                    "velocityXYZ": read(actor + 0x60, "3f"), "basis3x3": basis}]
        for entry in event["recordedControllerVectors"]:
            clock = entry["timeSeconds"]
            if clock < previous_clock:
                raise ValueError("Recorded opcode 337 clock moved backwards")
            if clock > previous_clock:
                dt = (clock - previous_clock) / subdivisions
                for _ in range(subdivisions):
                    previous = read(actor + 0x160, "3f")
                    old_velocity = read(actor + 0x60, "3f")
                    vm.mem_write(proposal, bytes(0x40))
                    vm.reg_write(r.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", dt))[0])
                    call(0x895FE0, movement, proposal)
                    speed, *motion = read(proposal, "7f")
                    if speed != missile["movement"]["startingSpeed"] or motion[3:] != [
                        f32(value * f32(dt)) for value in old_velocity
                    ]:
                        raise ValueError("Original saturated movement did not carry previous velocity into displacement")
                    spatial_notifications.clear()
                    call(0x8A1850, movement, proposal)
                    position = read(actor + 0x160, "3f")
                    if spatial_notifications != [position] or position == previous:
                        raise ValueError("Original applied position did not reach its spatial notification")
                    basis = update_basis()
            body_bytes = bytes.fromhex(entry["bodyHex"])
            if len(body_bytes) != 13 or hashlib.sha256(body_bytes).hexdigest() != entry["bodySha256"]:
                raise ValueError("Recorded opcode 337 body differs")
            vm.mem_write(packet, bytes(0x40))
            vm.mem_write(body, body_bytes)
            put(cursor, "Q", body)
            call(0x131D6C0, packet, cursor, body + len(body_bytes))
            if vm.reg_read(r.UC_X86_REG_AL) != 1 or read(cursor, "Q") != (body + len(body_bytes),):
                raise ValueError("Original opcode 337 reader rejected the saved payload")
            target_updates.clear()
            call(0x893530, actor, packet)
            expected_target = list(entry["vector"])
            if terrain_height is not None:
                expected_target[1] = f32(lookup_ground((expected_target[0], expected_target[2])) + plane_offset)
            if (vm.reg_read(r.UC_X86_REG_AL) != 1 or target_updates != [0]
                    or read(movement + 0x7C, "3f") != tuple(expected_target)):
                raise ValueError("Original opcode 337 consumer did not apply the recorded ground target")
            samples.append({"clock": clock, "positionXYZ": read(actor + 0x160, "3f"),
                            "velocityXYZ": read(actor + 0x60, "3f"), "basis3x3": basis})
            previous_clock = clock
        if len(terrain_queries) != (len(samples) if terrain_height is not None else 0):
            raise ValueError("Original ground rebase did not query its supplied terrain inputs")
        terrain_height = None
        return samples

    def observe_stopped_frame():
        put(actor + 0x3D8, "B", 1)
        put(actor + 0x60, "3f", 0, 0, 0)
        previous = bytes(vm.mem_read(vfx + 0x128, 64))
        vm.reg_write(r.UC_X86_REG_RBX, actor)
        vm.emu_start(image.base + 0x894D0C, image.base + 0x894D58, count=8)
        if (vm.reg_read(r.UC_X86_REG_RIP) != image.base + 0x894D58
                or bytes(vm.mem_read(vfx + 0x128, 64)) != previous):
            raise ValueError("Stopped missile control changed the VFX basis")

    def observe_retirement():
        put(actor + 0x3D8, "B", 0)
        put(particle_owner + 0x190, "I", 0)
        put(vfx + 0x65, "B", 0)
        movement_stop_requests.clear()
        call(0x893510, actor)
        if (read(actor + 0x3D8, "B") != (1,) or read(particle_owner + 0x190, "I") != (0,)
                or movement_stop_requests != [(0, 0, 0)]):
            raise ValueError("Original presentation stop did not reach the expected owner boundary")
        vm.ctl_remove_cache(image.base + 0x378E50, image.base + 0x379292)
        call(0x378E50, particle_owner, end=image.base + 0x378E8D)
        derived_vtable = 0x23CEF20
        for slot, entry in [(0xC8, 0x894C30), (0xF8, 0x894CB0), (0x1F0, 0x87CFB0)]:
            if read(image.base + derived_vtable + slot, "Q") != (image.base + entry,):
                raise ValueError("Original derived missile retirement vtable changed")

        # The frame fragment starts after caster validation. Its stack and
        # saved registers match the native prologue.
        frame = stack - 8
        put(frame - 0x20, "6Q", 0, 0, 0, 0, 0, stop)
        put(frame - 0x22, "2B", 0, 0)
        for register, value in ((r.UC_X86_REG_RBP, frame), (r.UC_X86_REG_RSP, frame - 0x80),
                                (r.UC_X86_REG_RBX, actor)):
            vm.reg_write(register, value)
        put(actor + 0x3D8, "B", 0)
        vm.emu_start(image.base + 0x87C61E, image.base + 0x87C62B, count=8)
        if vm.reg_read(r.UC_X86_REG_RIP) != image.base + 0x87C62B:
            raise ValueError("Unstopped missile did not enter movement")
        put(actor + 0x3D8, "B", 1)
        vm.emu_start(image.base + 0x87C61E, stop, count=64)
        if vm.reg_read(r.UC_X86_REG_RIP) != stop or vm.reg_read(r.UC_X86_REG_AL) != 0:
            raise ValueError("Stopped missile did not report frame failure")

        # Execute the failure branch and its original queue append with an
        # owned one-element buffer, then enter the original teardown callback.
        world, queue, secondary_callback = packet, body, cursor
        put(actor + 0xF0, "Q", world)
        put(world + 0x128, "3Q", queue, queue, queue + 8)
        removal_notifications.clear()
        vm.reg_write(r.UC_X86_REG_R13, actor)
        vm.reg_write(r.UC_X86_REG_RSP, stack - 0x80)
        vm.emu_start(image.base + 0x559AD0, image.base + 0x55996D, count=100)
        if (vm.reg_read(r.UC_X86_REG_RIP) != image.base + 0x55996D
                or read(world + 0x130, "Q") != (queue + 8,)
                or read(queue, "Q") != (actor,) or removal_notifications != [0]
                or read(particle_owner + 0x190, "I") != (0,)):
            raise ValueError("World frame failure did not enqueue the stopped actor")
        call(0x555FD0, world, actor)
        if read(world + 0x130, "Q") != (queue + 8,) or removal_notifications != [0]:
            raise ValueError("Repeated removal request did not preserve the original single queue entry")
        put(actor + 0x400, "Q", callback)
        put(actor + 0x418, "Q", secondary_callback)
        put(secondary_callback, "Q", actor)
        call(0x894C30, actor)
        put(actor + 0xF0, "Q", 0)
        if read(weak + 8, "Q") != (1,) or read(particle_owner + 0x190, "I") != (1,):
            raise ValueError("Original missile teardown did not retire its owned effect")
        vm.ctl_remove_cache(image.base + 0x378E50, image.base + 0x379292)
        call(0x378E50, particle_owner)
        if vm.reg_read(r.UC_X86_REG_AL) != 1:
            raise ValueError("Retired effect owner did not return through the native guard")
        return {"presentationStopMarkedMissile": True,
                "presentationStopMarkedVfxOwner": False,
                "unstoppedValidatedFrameEnteredMovement": True,
                "stoppedValidatedFrameResult": 0,
                "frameFailureEnqueuedOwnedActorOnce": True,
                "queueAppendMarkedVfxOwner": False,
                "teardownMarkedVfxOwner": True,
                "retiredOwnerUpdateResult": 1}

    cases = []
    for event in receipt["events"]:
        if event["missileSpell"] != "ZoeQMis2":
            continue
        start = event["creation"]["timeSeconds"]
        stop_time = event["presentationStop"]["timeSeconds"]
        if event["packetElapsedSeconds"] != 0 or start >= stop_time:
            raise ValueError("Expected zero-age creation and recorded presentation stop")
        request = observe_spawn(event, effect_key)
        changed_key = observe_spawn(event, effect_key ^ 1)
        if changed_key["spawnXYZ"] != request["spawnXYZ"]:
            raise ValueError("Perturbed effect identity changed its world spawn position")
        observe_spawn(event, effect_key)
        factory_target = observe_requested_factory_target(event)
        cast_target_basis = observe_basis(event["castTargetXYZ"])
        first_controller = event["recordedControllerVectors"][0]
        control = observe_basis(first_controller["vector"])
        if control["effectBasis3x3"] == cast_target_basis["effectBasis3x3"]:
            raise ValueError("Recorded comparison targets did not distinguish the native basis")
        observe_stopped_frame()
        packet_clock = controller_trace(event, factory_target, 1, 32)
        half_interval = controller_trace(event, factory_target, 2, 32)
        terrain_control = controller_trace(event, factory_target, 1, 64)
        if packet_clock[-1]["positionXYZ"] == half_interval[-1]["positionXYZ"]:
            raise ValueError("Expected a distinct position under a different stepping schedule")
        if (packet_clock[-1]["positionXYZ"] == terrain_control[-1]["positionXYZ"]
                or packet_clock[0]["basis3x3"] == terrain_control[0]["basis3x3"]):
            raise ValueError("Expected original terrain height to change the basis and trajectory")
        exact_trace = {}
        if exact_ground:
            plane_offset = exact_plane_offsets[event["entity"]]
            if plane_offset != f32(request["spawnXYZ"][1] - exact_ground[
                (request["spawnXYZ"][0], request["spawnXYZ"][2])
            ]):
                raise ValueError("Exact Map11 height did not reproduce the recorded source plane offset")
            map_steps = controller_trace(event, factory_target, 1, exact_ground, plane_offset)
            map_half_steps = controller_trace(event, factory_target, 2, exact_ground, plane_offset)
            if map_steps[-1]["positionXYZ"] == map_half_steps[-1]["positionXYZ"]:
                raise ValueError("Expected exact archived terrain to retain cadence sensitivity")
            exact_trace = {
                "exactMap11PacketClockTrace": map_steps,
                "exactMap11HalfIntervalControlLast": map_half_steps[-1],
                "exactMap11PlaneHeightOffset": plane_offset,
            }
        cases.append({
            "entity": event["entity"],
            "creation": event["creation"],
            "presentationStop": event["presentationStop"],
            "recordedPresentationDurationSeconds": stop_time - start,
            "effectPathHash": effect["pathHash"],
            "emitterIndex": 5,
            **request,
            "changedKeyControl": changed_key["nativeRequestedEffectHash"],
            "controlledInitialBasis": cast_target_basis,
            "observedFactoryCastTargetXYZ": factory_target,
            "firstControllerTargetControl": {"timeSeconds": first_controller["timeSeconds"], **control},
            "stoppedFrameSkippedBasisWriter": True,
            "controlledPacketClockTrace": packet_clock,
            "halfIntervalScheduleControlLast": half_interval[-1],
            "terrainHeightControl": {"suppliedTerrainHeight": 64, "first": terrain_control[0],
                                     "last": terrain_control[-1]},
            "controlledRetirement": observe_retirement(),
            **exact_trace,
        })
    if [row["entity"] for row in cases] != [1073742880, 1073743207]:
        raise ValueError("Expected both reviewed recorded Zoe recasts")
    print(json.dumps({
        "build": receipt["build"], "protocol": receipt["protocol"],
        "replaySha256": receipt["replaySha256"], "decoderSha256": digest,
        "sourceReceiptSha256": hashlib.sha256(evidence).hexdigest(),
        "exactMap11HeightReceiptSha256": ground_receipt_digest,
        "originalEntries": {"spawnConfig": 0x8AD3F0, "spawnRequest": 0x8AD7D0,
                            "initialVelocityFragment": 0x895F4F, "directionCallback": 0x8AE780,
                            "effectDirectionSetter": 0x1795DF0, "stoppedFrameGuard": 0x894D0C,
                            "controllerPacketReader": 0x131D6C0, "controllerReceive": 0x893530,
                            "controllerTargetConsumer": 0x8A6BA0, "proposal": 0x895FE0,
                            "applyProposal": 0x8A1850, "worldPositionSetter": 0x5560D0,
                            "movementFactoryCall": 0x87D8BF, "movementFactory": 0x88CE80,
                            "presentationStopCallback": 0x893510, "derivedFrame": 0x894CB0,
                            "validatedCasterStoppedGuard": 0x87C61E, "worldFrameFailure": 0x559AD0,
                            "worldRemovalQueue": 0x555FD0, "derivedTeardown": 0x894C30,
                            "teardownEffectOwner": 0x8AE350,
                            "effectOwnerUpdate": 0x378E50},
        "cases": cases,
        "suppliedTraceContext": {"terrainHeight": 32, "planeHeightOffset": 32, "stepsPerPacketInterval": 1},
        "scope": (
            "Original spawn, movement factory, opcode 337 target consumer, movement proposal/application "
            "and basis over recorded inputs. Exact Map11 height comes from the linked native grid receipt. "
            "Factory preprocessing, ownership, no collision and packet-clock cadence are supplied controls. "
            "The stopped-frame fragment begins after caster and delta validation. The original world removal "
            "branch enqueues the actor in a supplied queue with a modeled notification, then the probe "
            "explicitly invokes derived teardown with an empty component list. Original derived teardown "
            "marks the effect owner retired. The actual queue drain, render-frame schedule, collision result, "
            "full scene attachment and visible lifetime remain unverified."
        ),
    }, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
