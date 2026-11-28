"""Run the exact .8428 attack receiver with controlled actor and clock inputs."""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image

ACTOR_VTABLE = 0x236A6F8
CHARACTER_RECORD_GETTER = 0xC76E0
CHARACTER_HANDLE_GETTER = 0xD7640
SLOT_RANGE = (0x11D3A4, 0x11D49B)
TIMEBASE_RANGE = (0x160D787, 0x160D7EA)
DEADLINE_RANGE = (0x11D2C0, 0x11D31A)
ATTACK_PERIOD = 0x57D890
MACH_TIMEBASE_INFO = 0x2050F56
CLOCK_FACTOR = 0x25E68A8
CLOCK_FREQUENCY = 0x25E68A0
SCRATCH = 0x10000000
STACK = SCRATCH + 0x10000
ACTOR = SCRATCH + 0x20000
CHARACTER = SCRATCH + 0x25000
HANDLE = SCRATCH + 0x26000
ARMED_SLOTS = (64, 65, 73, 74)


def u32(value):
    return value & 0xFFFFFFFF


def ror(value, bits):
    return u32((value >> bits) | (value << (32 - bits)))


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def decode_next_attack_time(encoded):
    value = ror(u32(encoded - 0x50B3152B), 14) ^ 0x95CC8FFB
    bits = u32(value - 0xAF4CEAD5) ^ 0xFAA6D63D
    return struct.unpack("<f", struct.pack("<I", bits))[0]


class ReceiverProbe:
    def __init__(self, image):
        self.base = image.base
        self.vm = Uc(UC_ARCH_X86, UC_MODE_64)
        self.vm.mem_map(self.base, len(image.image))
        self.vm.mem_write(self.base, bytes(image.image))
        self.vm.mem_map(SCRATCH, 0x40000)
        assert image.imports[MACH_TIMEBASE_INFO] == "_mach_timebase_info"
        assert self.get(self.base + ACTOR_VTABLE + 0x288, "<Q") == self.base + CHARACTER_RECORD_GETTER
        assert self.get(self.base + ACTOR_VTABLE + 0xBA0, "<Q") == self.base + CHARACTER_HANDLE_GETTER
        self.put(ACTOR, "<Q", self.base + ACTOR_VTABLE)
        self.put(ACTOR + 0x35B0, "<Q", HANDLE)
        self.put(HANDLE + 0x28, "<Q", CHARACTER)

    def put(self, address, fmt, *values):
        self.vm.mem_write(address, struct.pack(fmt, *values))

    def get(self, address, fmt):
        return struct.unpack(fmt, self.vm.mem_read(address, struct.calcsize(fmt)))[0]

    def run(self, start, end, registers):
        self.vm.reg_write(reg.UC_X86_REG_RSP, STACK)
        self.vm.reg_write(reg.UC_X86_REG_RBP, STACK + 0x1000)
        for register, value in registers.items():
            self.vm.reg_write(register, value)
        self.vm.emu_start(self.base + start, end, count=1200)
        assert self.vm.reg_read(reg.UC_X86_REG_RIP) == end

    def run_range(self, bounds, registers):
        self.run(bounds[0], self.base + bounds[1], registers)

    def slot(self, name, requested, flags, cursors, available, expected):
        self.put(CHARACTER + 0x60, "<I", flags)
        self.vm.mem_write(CHARACTER + 0x3A0, bytes(slot in available for slot in range(64, 82)))
        self.put(ACTOR + 0x3980, "<HHHH", *cursors, 2, 2)
        self.run_range(SLOT_RANGE, {reg.UC_X86_REG_R13: requested, reg.UC_X86_REG_R14: ACTOR})
        selected = self.vm.reg_read(reg.UC_X86_REG_R13D)
        next_cursors = struct.unpack("<HH", self.vm.mem_read(ACTOR + 0x3980, 4))
        assert (selected, *next_cursors) == expected, name
        return {
            "case": name,
            "supplied": {
                "requestedSlot": requested,
                "characterFlags": flags,
                "normalCursor": cursors[0],
                "criticalCursor": cursors[1],
                "normalCycleLength": 2,
                "criticalCycleLength": 2,
                "availableSlots": available,
            },
            "observed": {"effectiveSlot": selected, "normalCursor": next_cursors[0], "criticalCursor": next_cursors[1]},
        }

    def timebase(self, numerator, denominator):
        def read_host_timebase(machine, _address, _size, _userdata):
            arguments = machine.reg_read(reg.UC_X86_REG_RDI)
            self.put(arguments, "<II", numerator, denominator)
            stack = machine.reg_read(reg.UC_X86_REG_RSP)
            machine.reg_write(reg.UC_X86_REG_RIP, self.get(stack, "<Q"))
            machine.reg_write(reg.UC_X86_REG_RSP, stack + 8)
            machine.reg_write(reg.UC_X86_REG_RAX, 0)

        address = self.base + MACH_TIMEBASE_INFO
        hook = self.vm.hook_add(UC_HOOK_CODE, read_host_timebase, begin=address, end=address)
        try:
            # Clear the cached-host-frequency flag so the real initializer calls the import again.
            self.put(self.base + 0x15056A7 + 0x109D2D1, "<B", 0)
            self.run_range(TIMEBASE_RANGE, {})
        finally:
            self.vm.hook_del(hook)
        factor = self.get(self.base + CLOCK_FACTOR, "<d")
        frequency = self.get(self.base + CLOCK_FREQUENCY, "<Q")
        assert frequency == denominator * 1_000_000_000 // numerator
        assert factor == 1 / frequency
        return {
            "supplied": {"machTimebaseNumerator": numerator, "machTimebaseDenominator": denominator},
            "observed": {"clockHz": frequency, "secondsPerTick": factor},
        }

    def configure_deadline_clock(self):
        holder, clock, clock_store, ticks, policy = (SCRATCH + offset for offset in range(0x31000, 0x36000, 0x1000))
        self.put(self.base + 0x11D2D8 + 0x23C5D58, "<Q", holder)
        self.put(holder + 0x10, "<Q", clock)
        self.put(clock, "<Q", clock_store)
        self.put(clock_store + 0x30, "<Q", ticks)
        self.put(self.base + 0x57D788 + 0x1F6B3A8, "<Q", policy)
        self.put(policy + 8, "<I", 2)
        self.put(self.base + 0x57D6F0 + 0x2058AC0 + 0x1C, "<ff", 0.05, 5.0)
        self.put(CHARACTER + 0xE58, "<f", 1.0)
        self.put(CHARACTER + 0x9DC, "<ff", 0.5, 1.0)
        self.put(ACTOR + 0x1018, "<f", 0.0)
        self.put(ACTOR + 0x38C4, "<I", ror(0x11CF23A6, 4))
        self.put(ACTOR + 0x38CC, "<I", ror(ror(u32(-0xFAA6D63D) ^ 0xFAA6D63D, 7) ^ 0xFAA6D63D, 12) ^ 0xC57F9AD0)
        return ticks

    def deadline(self, tick_address, ticks, centiseconds, speed_input, period_parameter):
        self.put(tick_address, "<q", ticks)
        self.put(ACTOR + 0xF44, "<f", speed_input)
        self.put(ACTOR + 0xF68, "<f", period_parameter)
        self.put(STACK, "<Q", SCRATCH)
        self.run(ATTACK_PERIOD, SCRATCH, {reg.UC_X86_REG_RDI: ACTOR})
        period_bits = u32(self.vm.reg_read(reg.UC_X86_REG_XMM0))
        period = struct.unpack("<f", struct.pack("<I", period_bits))[0]
        assert math.isfinite(period) and period > 0
        self.run_range(DEADLINE_RANGE, {reg.UC_X86_REG_R14: ACTOR, reg.UC_X86_REG_EAX: u32(centiseconds)})
        encoded = self.get(ACTOR + 0x3ABC, "<I")
        deadline = decode_next_attack_time(encoded)
        seconds = f32(ticks * self.get(self.base + CLOCK_FACTOR, "<d"))
        assert deadline == f32(f32(seconds + f32(centiseconds / 100)) + period)
        return {
            "supplied": {
                "clockTicks": ticks,
                "signedOffsetCentiseconds": centiseconds,
                "actorF44": speed_input,
                "actorF68": period_parameter,
            },
            "observed": {
                "attackPeriodSeconds": period,
                "encodedDeadlineBits": encoded,
                "nextAttackTimeSeconds": deadline,
            },
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    archive = parser.parse_args().archive.read_bytes()
    image = read_replication_image(archive, CURRENT_BUILD)
    probe = ReceiverProbe(image)
    slot_cases = [
        ("default keeps requested slot", 65, 0x802500, (0, 0), ARMED_SLOTS, (65, 0, 0)),
        ("first normal slot overrides request", 65, 0x902500, (0, 0), ARMED_SLOTS, (64, 1, 0)),
        ("normal cursor wraps", 64, 0x902500, (1, 0), ARMED_SLOTS, (65, 0, 0)),
        ("unavailable normal slot falls back", 65, 0x902500, (1, 0), (64, 73, 74), (64, 0, 0)),
        ("critical cursor wraps independently", 76, 0x902500, (1, 1), ARMED_SLOTS, (74, 1, 0)),
        ("unavailable critical slot falls back", 76, 0x902500, (1, 1), (64, 65, 73), (64, 1, 0)),
    ]
    timebase = [probe.timebase(n, d) for n, d in [(125, 3), (1, 1)]]
    tick_address = probe.configure_deadline_clock()
    deadlines = [
        probe.deadline(tick_address, ticks, offset, speed, period)
        for ticks, offset, speed, period in [
            (64_125_000_000, -4, 0.75, 0.85),
            (64_125_000_000, 0, 1.25, 1.1),
            (68_750_000_000, 6, 2.0, 1.4),
        ]
    ]
    assert len({row["observed"]["attackPeriodSeconds"] for row in deadlines}) == len(deadlines)
    print(
        json.dumps(
            {
                "build": CURRENT_BUILD,
                "archiveSha256": hashlib.sha256(archive).hexdigest(),
                "sliceSha256": hashlib.sha256(image.binary).hexdigest(),
                "originalRanges": {
                    "slot": SLOT_RANGE,
                    "timebase": TIMEBASE_RANGE,
                    "deadline": DEADLINE_RANGE,
                    "attackPeriodEntry": ATTACK_PERIOD,
                },
                "scope": (
                    "Controls supply the actor record, slot availability, cursors, stats and Mach timebase inputs. "
                    "Recorded actor state, the random-slot branch, animation start and warp remain unresolved."
                ),
                "slots": [probe.slot(*case) for case in slot_cases],
                "timebase": timebase,
                "deadlineControls": {
                    "mode": 2,
                    "periodBoundsSeconds": [0.05, 5.0],
                    "actorOverrideBounds": [0, 0],
                    "recordE58": 1.0,
                    "record9dc": 0.5,
                    "record9e0": 1.0,
                    "actor1018": 0.0,
                },
                "deadlines": deadlines,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
