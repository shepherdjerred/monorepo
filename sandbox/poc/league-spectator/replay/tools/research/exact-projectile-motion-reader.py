"""Measure the archived AcceleratingMovement step with explicit controlled inputs."""

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
    executable, receipt_path = map(Path, sys.argv[1:])
    binary = executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if (
        digest != "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
        or receipt["decoderSha256"] != digest
        or receipt["build"] != "16.23.840.6595"
        or receipt["protocol"] != "8bbfcd5af2bc92db"
    ):
        raise ValueError("Expected reviewed exact 16.23.840.6595 inputs")
    (asset,) = (row for row in receipt["assets"] if row["spell"] == "ZoeQMis2")
    properties = asset["movement"]
    if properties["classHash"] != "af905da2":
        raise ValueError("Expected authored AcceleratingMovement")
    acceleration, minimum, maximum, starting = (
        properties[key]
        for key in ("acceleration", "minimumSpeed", "maximumSpeed", "startingSpeed")
    )

    image = MachImage(binary)
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))
    stop, controller, missile, proposal, stack = (
        0x10000000, 0x10001000, 0x10002000, 0x10003000, 0x1000F008
    )
    vm.mem_map(stop, 0x10000)
    vtable_rva = 0x23CF2E0
    step_slot = 0xE8
    (step_address,) = struct.unpack(
        "<Q", vm.mem_read(image.base + vtable_rva + step_slot, 8)
    )
    if step_address != image.base + 0x895FE0:
        raise ValueError("Unexpected native movement proposal entry")

    def step(seconds, speed, speed_properties):
        vm.mem_write(stack, struct.pack("<Q", stop))
        vm.mem_write(controller, struct.pack("<Q", image.base + vtable_rva))
        vm.mem_write(controller + 0x18, struct.pack("<Q", missile))
        vm.mem_write(controller + 0x7C, struct.pack("<3f", 4096, 0, 0))
        vm.mem_write(controller + 0xA0, struct.pack("<f", speed))
        vm.mem_write(controller + 0xD8, struct.pack("<3f", *speed_properties))
        vm.mem_write(missile + 0x60, struct.pack("<3f", speed, 0, 0))
        vm.mem_write(proposal, bytes(32))
        for register, value in (
            (reg.UC_X86_REG_RDI, controller),
            (reg.UC_X86_REG_RSI, proposal),
            (reg.UC_X86_REG_RSP, stack),
            (reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", seconds))[0]),
        ):
            vm.reg_write(register, value)
        vm.emu_start(step_address, stop, count=2000)
        if vm.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError("Native movement proposal did not return")
        final_speed, *_, dx, dy, dz = struct.unpack("<7f", vm.mem_read(proposal, 28))
        return {
            "seconds": seconds,
            "speed": final_speed,
            "displacement": [dx, dy, dz],
        }

    exact_properties = (acceleration, minimum, maximum)
    samples = [step(seconds, starting, exact_properties) for seconds in (0, 0.125, 0.5)]
    if (
        exact_properties != (2000, 2500, 2500)
        or starting != 2500
        or any(
            sample["speed"] != 2500
            or sample["displacement"] != [2500 * sample["seconds"], 0, 0]
            for sample in samples
        )
    ):
        raise ValueError("Archived Zoe Q recast movement changed")
    unclamped = step(0.25, 500, (1000, 100, 1000))
    upper_clamp = step(0.75, 500, (1000, 100, 1000))
    if (
        unclamped["speed"] != 750 or unclamped["displacement"] != [156.25, 0, 0]
        or upper_clamp["speed"] != 1000 or upper_clamp["displacement"] != [625, 0, 0]
    ):
        raise ValueError("Native movement control did not exercise expected acceleration")
    print(json.dumps({
        "build": receipt["build"],
        "protocol": receipt["protocol"],
        "replaySha256": receipt["replaySha256"],
        "decoderSha256": digest,
        "spellSource": asset["spellSource"],
        "movement": properties,
        "nativeEntries": {
            "authoredRegistration": 0x88BBB0,
            "runtimeFactory": 0x88CE80,
            "runtimeVtable": vtable_rva,
            "proposeStep": step_address - image.base,
        },
        "nativeSamples": samples,
        "syntheticControls": [unclamped, upper_clamp],
        "scope": "Native displacement proposal with controlled pose/velocity; no recorded world trajectories or rendering.",
    }, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
