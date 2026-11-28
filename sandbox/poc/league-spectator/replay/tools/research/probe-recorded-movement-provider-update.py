"""Verify .8428 movement-provider state writes on two pinned Maokai waypoint rows."""

import argparse
import hashlib
import json
import struct
import subprocess
import sys
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("executable", type=Path)
parser.add_argument("replay", type=Path)
parser.add_argument("champion_source_manifest", type=Path)
args = parser.parse_args()
archive = args.executable.read_bytes()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


assert digest(archive) == "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
image = MachImage(archive)
source = subprocess.run(
    [
        "bun",
        str(Path(__file__).with_name("extract-movement-provider-witness.mjs")),
        str(args.replay),
        str(args.executable),
        str(args.champion_source_manifest),
    ],
    check=True,
    stdout=subprocess.PIPE,
).stdout.strip()
proof = json.loads(source)
assert proof["archiveSha256"] == digest(archive)
cases = proof["rows"]


def native_expand(encoded):
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    code = image.base
    vm.mem_map(code, len(image.image))
    vm.mem_write(code, bytes(image.image))
    arena = 0x10000000
    vm.mem_map(arena, 0x5000)
    wrapper, table, output_vector, output_data, input_vector, input_data, stack, stop, virtual_site = (
        arena + offset for offset in (0x100, 0x300, 0x700, 0x800, 0xA00, 0xB00, 0x3F08, 0x4000, 0x4100)
    )
    origin_x, origin_z = 7358, 7412
    vm.mem_write(code + 0x25B1332, struct.pack("<hh", origin_x, origin_z))
    vm.mem_write(code + 0x25B1330, b"\x01")
    vm.mem_write(wrapper, struct.pack("<Q", table))
    vm.mem_write(table + 0x128, struct.pack("<Q", virtual_site))
    vm.mem_write(output_vector, struct.pack("<QII", output_data, 0, 8))
    vm.mem_write(input_vector, struct.pack("<QQ", input_data, input_data + 4 * len(encoded)))
    vm.mem_write(input_data, b"".join(struct.pack("<hh", x, z) for x, z in encoded))
    vm.mem_write(stack, struct.pack("<Q", stop))
    for reg, val in (
        (r.UC_X86_REG_RSP, stack),
        (r.UC_X86_REG_RDI, wrapper),
        (r.UC_X86_REG_RSI, output_vector),
        (r.UC_X86_REG_RDX, input_vector),
        (r.UC_X86_REG_RCX, 0),
    ):
        vm.reg_write(reg, val)
    effects = []

    def boundary(vm, pc, _size, _state):
        if pc not in (code + 0x16DF8F0, virtual_site):
            return
        # This probe isolates X/Z. Ground height and path notifications are
        # deliberately modeled and never become provider state evidence.
        effects.append("ground-height" if pc != virtual_site else "path-notification")
        if pc == code + 0x16DF8F0:
            vm.reg_write(r.UC_X86_REG_XMM0, 0)
        rsp = vm.reg_read(r.UC_X86_REG_RSP)
        vm.reg_write(r.UC_X86_REG_RIP, struct.unpack("<Q", vm.mem_read(rsp, 8))[0])
        vm.reg_write(r.UC_X86_REG_RSP, rsp + 8)

    vm.hook_add(UC_HOOK_CODE, boundary)
    vm.emu_start(code + 0x1A3C60, stop, count=5000)
    assert vm.reg_read(r.UC_X86_REG_RIP) == stop
    actual = struct.unpack("<I", vm.mem_read(output_vector + 8, 4))[0]
    assert actual == len(encoded)
    result = [[x, z] for x, _, z in struct.iter_unpack("<3f", vm.mem_read(output_data, 12 * actual))]
    assert result == [[origin_x + x * 2, origin_z + z * 2] for x, z in encoded]
    assert effects == ["ground-height", "path-notification"] * actual
    return result


def witness(row, elapsed, collision, wrapper_eligible):
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    base = image.base
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    arena = 0x10000000
    vm.mem_map(arena, 0x10000)
    provider, actor, actor_table, wrapper, path, stack, stop = (
        arena + value for value in (0x100, 0x1000, 0x6000, 0x7200, 0x7600, 0xCF08, 0xE000)
    )
    point = row["nativeExpandedXZ"]
    world = [[x, 0.0, z] for x, z in point]
    vm.mem_write(actor + 0x160, struct.pack("<3f", *world[0]))
    vm.mem_write(path, struct.pack("<3f", *world[1 if len(world) > 1 else 0]))
    vm.mem_write(base + 0x24E8B40, struct.pack("<Q", arena + 0x7C00))
    clock_holder, clock, clock_owner, clock_bank = (arena + offset for offset in (0x7C80, 0x7D00, 0x7D80, 0x7E00))
    vm.mem_write(base + 0x24E3030, struct.pack("<Q", clock_holder))
    vm.mem_write(clock_holder + 0x10, struct.pack("<Q", clock))
    vm.mem_write(clock, struct.pack("<Q", clock_owner))
    vm.mem_write(clock_owner + 0x30, struct.pack("<Q", clock_bank))
    # Feed requested test times to the native clock bank. The absolute
    # packet clock is a selected control, not the original actor tick time.
    frequency = 1_000_000_000
    vm.mem_write(
        clock_bank,
        struct.pack("<qq", round(row["timeSeconds"] * frequency), round(elapsed * frequency)),
    )
    vm.mem_write(actor, struct.pack("<Q", actor_table))
    trap = {}
    animator = arena + 0x9200
    for slot in (0x688, 0x138, 0x2C8, 0xEC8, 0xE08, 0xDA0):
        pc = stop + 0x10 + len(trap) * 0x10
        trap[pc] = slot
        vm.mem_write(actor_table + slot, struct.pack("<Q", pc))
    vm.mem_write(stack, struct.pack("<Q", stop))
    vm.reg_write(r.UC_X86_REG_RSP, stack)
    vm.reg_write(r.UC_X86_REG_RDI, provider + 8)
    vm.reg_write(r.UC_X86_REG_RSI, actor)
    events = []
    boundary = "return"
    run_dispatch = None

    def ret():
        rsp = vm.reg_read(r.UC_X86_REG_RSP)
        vm.reg_write(r.UC_X86_REG_RIP, struct.unpack("<Q", vm.mem_read(rsp, 8))[0])
        vm.reg_write(r.UC_X86_REG_RSP, rsp + 8)

    def step(_cpu, pc, _size, _state):
        nonlocal boundary, run_dispatch
        ip = pc - base
        if ip in (0x16103E0, 0x555EF0, 0x555F40, 0xB61CC, 0xB71AA, 0xB6749, 0xB631A):
            events.append(hex(ip))
        if ip == 0xB631A:
            boundary = "collision-solver-entry"
            vm.emu_stop()
        elif ip == 0xB6EEE:
            boundary = "post-step-provider-dispatch"
            vm.emu_stop()
        elif pc in trap:
            slot = trap[pc]
            results = {0x688: wrapper, 0x2C8: int(collision), 0xEC8: animator}
            vm.reg_write(r.UC_X86_REG_RAX, results.get(slot, 0))
            ret()
        elif ip == 0x15A2CC0:
            assert vm.reg_read(r.UC_X86_REG_RDI) == animator
            run_dispatch = {
                "nameHash": f"{vm.reg_read(r.UC_X86_REG_ESI):08x}",
                "flags": vm.reg_read(r.UC_X86_REG_ECX),
                "selector": vm.reg_read(r.UC_X86_REG_EDX),
                "initialRateBits": f"{vm.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF:08x}",
            }
            vm.emu_stop()
        elif ip == 0x2051310:
            assert bytes(vm.mem_read(vm.reg_read(r.UC_X86_REG_RDI), 4)) == b"Run\0"
            vm.reg_write(r.UC_X86_REG_RAX, 3)
            ret()
        elif ip == 0x14A0300:
            assert vm.reg_read(r.UC_X86_REG_RDI) == 0xD0
            vm.reg_write(r.UC_X86_REG_RAX, provider)
            ret()
        elif ip == 0xB95A0:
            vm.reg_write(r.UC_X86_REG_RAX, 1)
            ret()
        elif ip in (0xB0300, 0xB7250):
            ret()
        elif ip == 0xAC070:
            vm.reg_write(r.UC_X86_REG_RAX, path)
            ret()
        elif ip == 0x16DF8F0:
            vm.reg_write(r.UC_X86_REG_XMM0, 0)
            ret()

    vm.hook_add(UC_HOOK_CODE, step)
    vm.reg_write(r.UC_X86_REG_RCX, frequency)
    vm.emu_start(base + 0x160D7B1, base + 0x160D7EA, count=40)
    assert vm.reg_read(r.UC_X86_REG_RIP) == base + 0x160D7EA
    assert struct.unpack("<d", vm.mem_read(base + 0x25E68A8, 8))[0] == 1 / frequency
    vm.emu_start(base + 0x569320, stop, count=100)
    assert vm.reg_read(r.UC_X86_REG_RIP) == stop
    mode = vm.reg_read(r.UC_X86_REG_RAX)
    assert mode == 1
    vm.reg_write(r.UC_X86_REG_RDI, mode)
    vm.reg_write(r.UC_X86_REG_RSI, actor)
    vm.reg_write(r.UC_X86_REG_RSP, stack)
    vm.emu_start(base + 0xB8B70, stop, count=500)
    assert vm.reg_read(r.UC_X86_REG_RIP) == stop
    assert vm.reg_read(r.UC_X86_REG_RAX) == provider + 8
    assert struct.unpack("<QQ", vm.mem_read(provider, 16)) == (base + 0x235E5A0, base + 0x235E618)
    assert vm.mem_read(provider + 0xB0, 1)[0] == 0
    wrapper_object, wrapper_table = arena + 0x8300, arena + 0x8800
    vm.mem_write(wrapper + 0x10, struct.pack("<Q", wrapper_object))
    vm.mem_write(wrapper_object, struct.pack("<Q", wrapper_table))
    vm.reg_write(r.UC_X86_REG_RSP, stack)
    vm.reg_write(r.UC_X86_REG_RDI, wrapper)
    vm.reg_write(r.UC_X86_REG_RSI, int(wrapper_eligible))
    vm.emu_start(base + 0xAEB40, stop, count=100)
    assert vm.reg_read(r.UC_X86_REG_RIP) == stop
    # Retain a previous-frame true value as a control on the clearing write.
    vm.mem_write(provider + 0xB0, b"\x01")
    vm.reg_write(r.UC_X86_REG_RSP, stack)
    vm.reg_write(r.UC_X86_REG_RDI, provider + 8)
    vm.reg_write(r.UC_X86_REG_RSI, actor)
    try:
        vm.emu_start(base + 0xB8060, stop, count=5000)
    except Exception as error:
        raise RuntimeError(hex(vm.reg_read(r.UC_X86_REG_RIP) - base)) from error
    active = vm.mem_read(provider + 0xB0, 1)[0]
    assert boundary == ("collision-solver-entry" if collision else "post-step-provider-dispatch")
    assert events[:2] == ["0x16103e0", "0xb61cc"]
    assert active == int(not collision and wrapper_eligible)
    position = struct.unpack("<3f", vm.mem_read(actor + 0x160, 12))
    history = None
    movement_predicate = None
    if not collision:
        assert "0x555ef0" in events, events
        vm.reg_write(r.UC_X86_REG_R13, actor)
        vm.emu_start(base + 0xC335F, base + 0xC3433, count=100)
        assert vm.reg_read(r.UC_X86_REG_RIP) == base + 0xC3433
        history = struct.unpack("<4f", vm.mem_read(actor + 0x376C, 16))
        assert history[:3] == position
        assert struct.pack("<f", history[3]) == struct.pack("<f", row["timeSeconds"])
        # Exercise the exact fallback predicate suffix with the freshly
        # updated provider flag. The actor eligibility gate is a control.
        vm.mem_write(actor + 0xC88, b"\x04")
        vm.mem_write(path + 0x30, struct.pack("<I", len(world)))
        for register, value in (
            (r.UC_X86_REG_RBX, actor),
            (r.UC_X86_REG_R14, provider),
            (r.UC_X86_REG_R15, int(wrapper_eligible)),
            (r.UC_X86_REG_RAX, path),
            (r.UC_X86_REG_R12, path),
            (r.UC_X86_REG_RSP, stack - 0x58),
        ):
            vm.reg_write(register, value)
        vm.emu_start(base + 0xB8158, stop, count=200)
        assert vm.reg_read(r.UC_X86_REG_RIP) == stop
        movement_predicate = bool(vm.reg_read(r.UC_X86_REG_AL))
        assert movement_predicate == (wrapper_eligible and len(world) >= 2)
        if movement_predicate:
            # Demonstrate invocation once Run selection has occurred. The
            # intervening animator and attack/preemption checks are unbound.
            vm.reg_write(r.UC_X86_REG_RSP, stack)
            vm.reg_write(r.UC_X86_REG_RDI, actor)
            vm.emu_start(base + 0x1152B0, stop, count=1000)
            assert vm.reg_read(r.UC_X86_REG_RIP) == base + 0x15A2CC0
            assert run_dispatch == {"nameHash": "2acd4eca", "flags": 1, "selector": 1, "initialRateBits": "3f800000"}
    return {
        "frameSeconds": elapsed,
        "collisionRequested": collision,
        "boundary": boundary,
        "providerActive": active,
        "originalBranches": events,
        "nativeConstructorMode": mode,
        "wrapperEligibilityControl": wrapper_eligible,
        "actorAfterNativePositionCommit": position,
        "nativeHistoryBeforeAnimatorInvocation": history,
        "movementPredicateUnderControlledGate": movement_predicate,
        "runDispatchUnderControlledSelection": run_dispatch,
    }


for row in cases:
    row["nativeExpandedXZ"] = native_expand(row["encodedWaypoints"])
    row["waypointCount"] = len(row["nativeExpandedXZ"])

print(
    json.dumps(
        {
            "archiveSha256": digest(archive),
            "pathProofSha256": digest(source),
            "replaySha256": proof["replaySha256"],
            "championManifestSha256": proof["manifestSha256"],
            "scope": (
                "Original mode-1 constructor, wrapper flag writer/reader, provider update, "
                "and clear-frame position commits. Allocator, first update admission, actor target, "
                "clock-bank inputs, collision query and ground are controls. Clear-frame history rotation "
                "and the original movement gate suffix are checked separately. The Run invocation prefix "
                "is controlled, with animator selection and preemption outside this proof. "
                "Collision solving is a stop boundary."
            ),
            "witnesses": [
                {
                    "timeSeconds": row["timeSeconds"],
                    "blockOffset": row["blockOffset"],
                    "packetSha256": row["packetSha256"],
                    "nativeExpandedXZ": row["nativeExpandedXZ"],
                    "waypointCount": row["waypointCount"],
                    "controls": [
                        witness(row, elapsed, collision, wrapper_eligible)
                        for elapsed in (0.0, 0.016, 0.1)
                        for collision in (False, True)
                        for wrapper_eligible in (False, True)
                    ],
                }
                for row in cases
            ],
        },
        indent=2,
    )
)
