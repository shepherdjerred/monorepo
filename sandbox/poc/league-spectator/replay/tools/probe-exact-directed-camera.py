"""Execute the archived x86-64 directed-camera switch block with controlled inputs."""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as reg

BUILD = "16.23.840.6595"
PROTOCOL = "8bbfcd5af2bc92db"
EXECUTABLE_HASH = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
SWITCH_BLOCK = 0x79E039
SWITCH_EPILOGUE = 0x79E10E
REPLAY_CLOCK_GETTER = 0x1610390
REPLAY_CLOCK_GLOBAL = 0x24E3030
CLOCK_CONTEXT = 0x6000000
DIRECTOR = CLOCK_CONTEXT + 0x1000
STACK = CLOCK_CONTEXT + 0x2000
INVALID_FOCUS = 0


def f32(value):
    return struct.pack("<f", value)


def u32(value):
    return struct.pack("<I", value)


def qword(value):
    return struct.pack("<Q", value)


def switch_control(machine, *, candidate, candidate_interest, current_interest, elapsed):
    # At this interior block the original scorer/actor callbacks have already
    # run. Supply only their outputs and the clock consumed by this block.
    owner = bytearray(0x320)
    for offset, value in {
        0: 10.0,
        0x10: 25.0,
        0x14: 0.25,
        0x114: 0.25,
        0x118: 2.0,
        0x124: 30.0,
        0x128: 4.0,
        0x12C: 0.35,
        0x130: 0.1,
        0x25C: 12.0,
        0x264: 8.0,
        0x268: 0.15,
    }.items():
        owner[offset : offset + 4] = f32(value)
    owner[8:12] = u32(101)
    owner[0x260:0x264] = u32(50)
    owner[0x30] = owner[0x110] = 1
    machine.mem_write(DIRECTOR, bytes(owner))
    machine.reg_write(reg.UC_X86_REG_RSP, STACK)
    machine.reg_write(reg.UC_X86_REG_R13, DIRECTOR)
    machine.reg_write(reg.UC_X86_REG_RAX, 0)
    machine.reg_write(reg.UC_X86_REG_RDX, candidate)
    machine.reg_write(reg.UC_X86_REG_RBX, current_interest)
    machine.reg_write(reg.UC_X86_REG_XMM0, int.from_bytes(f32(25.0), "little"))
    machine.reg_write(reg.UC_X86_REG_XMM1, int.from_bytes(f32(candidate_interest), "little"))

    clock_reads = 0

    def return_clock(emu, _address, _size, _data):
        nonlocal clock_reads
        if emu.reg_read(reg.UC_X86_REG_RDI) != CLOCK_CONTEXT + 0x40:
            raise ValueError("Unexpected native replay clock owner")
        clock_reads += 1
        stack = emu.reg_read(reg.UC_X86_REG_RSP)
        emu.reg_write(reg.UC_X86_REG_XMM0, int.from_bytes(f32(10 + elapsed), "little"))
        emu.reg_write(reg.UC_X86_REG_RSP, stack + 8)
        emu.reg_write(reg.UC_X86_REG_RIP, int.from_bytes(emu.mem_read(stack, 8), "little"))

    hook = machine.hook_add(UC_HOOK_CODE, return_clock, begin=REPLAY_CLOCK_GETTER, end=REPLAY_CLOCK_GETTER)
    try:
        machine.emu_start(SWITCH_BLOCK, SWITCH_EPILOGUE, count=150)
    finally:
        machine.hook_del(hook)
    if machine.reg_read(reg.UC_X86_REG_RIP) != SWITCH_EPILOGUE or clock_reads != 1:
        raise ValueError("Original camera switch block did not reach its expected boundary")
    owner = machine.mem_read(DIRECTOR, len(owner))
    return {
        "input": {
            "candidate": candidate,
            "candidateInterest": candidate_interest,
            "currentFocus": 101,
            "currentInterest": current_interest,
            "elapsed": elapsed,
        },
        "focus": struct.unpack_from("<I", owner, 8)[0],
        "previousFocus": struct.unpack_from("<I", owner, 12)[0],
        "switched": bool(machine.reg_read(reg.UC_X86_REG_AL)),
        "since": struct.unpack_from("<f", owner, 0)[0],
        "nextUpdateDelay": struct.unpack_from("<f", owner, 4)[0],
        "threshold": struct.unpack_from("<f", owner, 0x10)[0],
        "percentThreshold": struct.unpack_from("<f", owner, 0x14)[0],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Fresh directed camera receipt path required")
    client = args.client.read_bytes()
    if hashlib.sha256(client).hexdigest() != EXECUTABLE_HASH:
        raise ValueError(f"Expected the exact archived {BUILD} universal Mach-O")
    image = MachImage(client)
    machine = Uc(UC_ARCH_X86, UC_MODE_64)
    machine.mem_map(0, len(image.image))
    machine.mem_write(0, bytes(image.image))
    machine.mem_map(CLOCK_CONTEXT, 0x4000)
    machine.mem_write(REPLAY_CLOCK_GLOBAL, qword(CLOCK_CONTEXT))
    machine.mem_write(CLOCK_CONTEXT + 0x10, qword(CLOCK_CONTEXT + 0x40))
    # This global slot is zero in the static image. Record the chosen value as
    # a control input rather than inferring the live registry's invalid ID.
    machine.mem_write(0x2547AC0, u32(INVALID_FOCUS))

    cases = [
        ("absoluteThresholdBlocks", 24, 0, 1.0),
        ("percentageThresholdBlocks", 40, 40, 1.0),
        ("switchAllowed", 100, 40, 1.0),
        ("forcedClear", 40, 40, 13.0),
    ]
    controls = {}
    for name, candidate_interest, current_interest, elapsed in cases:
        controls[name] = switch_control(
            machine,
            candidate=202,
            candidate_interest=candidate_interest,
            current_interest=current_interest,
            elapsed=elapsed,
        )
    for name in ("absoluteThresholdBlocks", "percentageThresholdBlocks"):
        if (controls[name]["focus"], controls[name]["switched"], controls[name]["threshold"]) != (101, False, 24.0):
            raise ValueError(f"Switch threshold control differed: {name}")
    if (controls["switchAllowed"]["focus"], controls["switchAllowed"]["switched"]) != (202, True):
        raise ValueError("Allowed switch control differed")
    if (controls["forcedClear"]["focus"], controls["forcedClear"]["previousFocus"]) != (0, 101):
        raise ValueError("Forced clear control differed")

    with args.output.open("x", encoding="utf-8") as output:
        json.dump(
            {
                "kind": "original-directed-camera-switch-block-controls",
                "build": BUILD,
                "protocol": PROTOCOL,
                "executableSha256": EXECUTABLE_HASH,
                "originalRvas": {
                    "directorConstructor": 0x797930,
                    "policyConfiguration": 0x797F40,
                    "modeToggle": 0x7A6080,
                    "selectionCaller": 0x7A64B0,
                    "selector": 0x79DC20,
                    "futureDeathInputs": 0x7993C0,
                    "futureDamageInputs": 0x79A6A0,
                    "framing": 0x79E180,
                    "switchBlock": SWITCH_BLOCK,
                    "clockGetter": REPLAY_CLOCK_GETTER,
                },
                "controls": controls,
                "scope": {
                    "switchArithmeticExecuted": True,
                    "controlledPolicyAndScoreInputs": True,
                    "originalScoreInputsFromRofl": False,
                    "perspectiveAndFramingExecuted": False,
                },
            },
            output,
            indent=2,
        )
        output.write("\n")


if __name__ == "__main__":
    main()
