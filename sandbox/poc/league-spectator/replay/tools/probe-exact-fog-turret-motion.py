"""Exercise authentic opcode 944 bodies with controlled native turret motion state."""

import argparse
import hashlib
import importlib
import json
import math
import struct
from pathlib import Path

from unicorn import UC_HOOK_CODE
from unicorn import x86_const as reg

turret = importlib.import_module("probe-exact-fog-turret-owner")
ENVELOPE_SHA = "00cd1de7c60501fac5775936d8b1f143d44946dc7df59226aa267977ddb4af9b"


class MotionOracle(turret.TurretOracle):
    def return_to_caller(self, value):
        stack = self.cpu.reg_read(reg.UC_X86_REG_RSP)
        self.cpu.reg_write(reg.UC_X86_REG_RAX, value)
        self.cpu.reg_write(reg.UC_X86_REG_RSP, stack + 8)
        self.cpu.reg_write(reg.UC_X86_REG_RIP, self.get(stack))

    def operation(self, cpu, address, size, name):
        if name == "_mach_absolute_time":
            result = self.get(self.ARENA + 0x4600)
        elif name == "_llround":
            bits = cpu.reg_read(reg.UC_X86_REG_XMM0) & ((1 << 64) - 1)
            value = struct.unpack("<d", struct.pack("<Q", bits))[0]
            result = int(math.copysign(math.floor(abs(value) + 0.5), value))
        elif name == "__tlv_atexit":
            # Registration belongs to the host. The whole emulated thread is discarded.
            result = 0
        else:
            return super().operation(cpu, address, size, name)
        self.calls[name] += 1
        self.return_to_caller(result & ((1 << 64) - 1))

    def install_host(self):
        arena = self.ARENA
        clock = arena + 0x4400
        clock_root = arena + 0x4300
        clock_source = arena + 0x4500
        master = arena + 0x4700
        self.put(self.base + 0x24E3030, clock_root)
        self.put(clock_root + 0x10, clock)
        self.put(clock, clock_source)
        self.put(clock_source + 0x30, arena + 0x4600)
        self.put(clock_root + 8, master)
        self.put(master + 0x78, master + 0x80)
        self.put(master + 0x40, arena + 0x4800)
        self.put(arena + 0x4800, clock_source)
        self.cpu.mem_write(self.base + 0x25E68A8, struct.pack("<d", 1e-9))

        def seed_context(cpu, *_):
            context = cpu.reg_read(reg.UC_X86_REG_RDI)
            cpu.mem_write(context + 0xC, struct.pack("<I", self.packet_owner))
            self.return_to_caller(1)

        def bootstrap_tls(cpu, *_):
            record = cpu.reg_read(reg.UC_X86_REG_RDI)
            if record - self.base not in descriptors:
                raise ValueError("Unexpected thread-local descriptor")
            self.return_to_caller(arena + 0xC000 + self.get(record + 16))

        callback = self.base + 0x1637CB0
        self.cpu.hook_add(UC_HOOK_CODE, seed_context, begin=callback, end=callback)
        callback = arena + 0xCC00
        self.cpu.hook_add(UC_HOOK_CODE, bootstrap_tls, begin=callback, end=callback)
        descriptors = range(0x24FE688, 0x24FE7A8, 24)
        self.cpu.mem_write(arena + 0xC000, bytes(self.image.image[0x24FE7B0:0x24FE7B1]))
        for record in descriptors:
            self.put(self.base + record, callback)

    def install_rng_seed_control(self, seed):
        if self.image.imports.get(0x2050F14) != "_mach_absolute_time":
            raise ValueError("Unexpected native startup clock binding")
        # Stop after native startup seeds the movement RNG from a host clock tick.
        # The tick supplied here is an experimental input.
        self.put(self.ARENA + 0x4600, seed)
        self.call(0x66DA39, {}, stop_rva=0x66DA46)
        if self.get(self.base + 0x258D958) != max(1, seed):
            raise ValueError("Native startup did not install the movement seed")

    def initialize_movement(self, row, index, *, owner_vtable=turret.VTABLE):
        owner = self.ARENA + 0x2000000 + index * 0x10000
        receiver = owner + 0x4000
        movement = owner + 0x5000
        self.put(owner, self.base + owner_vtable)
        self.cpu.mem_write(owner + 0x160, struct.pack("<3f", *row["authoredXYZ"]))
        self.call(0xABA10, {reg.UC_X86_REG_RDI: receiver, reg.UC_X86_REG_RSI: owner})
        self.call(
            0xB8A50,
            {
                reg.UC_X86_REG_RDI: movement,
                reg.UC_X86_REG_RSI: owner,
                reg.UC_X86_REG_RDX: 0,
                reg.UC_X86_REG_RCX: 0,
                reg.UC_X86_REG_R8: 0,
            },
        )
        self.call(
            0xBDAC3,
            {reg.UC_X86_REG_R15: movement, reg.UC_X86_REG_RBX: owner},
            stop_rva=0xBDAEC,
        )
        if self.call(0xD6F30, {reg.UC_X86_REG_RDI: owner}) != movement:
            raise ValueError("Original movement selector returned a different object")
        return receiver, movement

    def decode_position_packet(self, row):
        arena = self.ARENA
        self.packet_owner = row["ownerId"]
        data = bytes.fromhex(row["payloadHex"])
        self.call(0x1018AB2, {reg.UC_X86_REG_RBX: arena + 0x4000}, stop_rva=0x101C304)
        packet = self.get(arena + 0x4000)
        self.cpu.mem_write(arena + 0x4100, data)
        self.put(arena + 0x4200, arena + 0x4100)
        result = self.call(
            0x1190D20,
            {
                reg.UC_X86_REG_RDI: packet,
                reg.UC_X86_REG_RSI: arena + 0x4200,
                reg.UC_X86_REG_RDX: arena + 0x4100 + len(data),
            },
        )
        if result & 0xFF != 1 or self.get(arena + 0x4200) != arena + 0x4100 + len(data):
            raise ValueError("Original position reader failed to consume the packet body")
        self.call(0x56B5D0, {reg.UC_X86_REG_RDI: packet}, stop_rva=0x56B661)
        if self.cpu.reg_read(reg.UC_X86_REG_ESI) != self.packet_owner:
            raise ValueError("Original dispatch decoded a different owner context")
        flag_index = self.get(packet + 0x20, "B")
        if self.get(self.base + 0x21350A0 + flag_index, "B") & 1:
            raise ValueError("Position now enters the queued-update branch")
        return packet

    def apply_position(self, row, receiver, movement, applications):
        arena = self.ARENA
        packet = self.decode_position_packet(row)
        self.put(arena + 0x4600, round(row["timeSeconds"] * 1e9))
        for _ in range(applications):
            self.call(0xAC090, {reg.UC_X86_REG_RDI: receiver, reg.UC_X86_REG_RSI: packet})
        address = self.call(0xAC070, {reg.UC_X86_REG_RDI: movement})
        return struct.unpack("<3f", self.cpu.mem_read(address, 12))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mach_slice", type=Path)
    parser.add_argument("navgrid", type=Path)
    parser.add_argument("envelopes", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--reapply-opening", action="store_true")
    parser.add_argument("--rng-startup-tick", type=int)
    args = parser.parse_args()
    envelope_bytes = args.envelopes.read_bytes()
    if hashlib.sha256(envelope_bytes).hexdigest() != ENVELOPE_SHA:
        raise ValueError("Unexpected exact replay position envelopes")
    report = json.loads(envelope_bytes)
    oracle = MotionOracle(turret.MachImage(args.mach_slice.read_bytes()), args.navgrid.read_bytes())
    oracle.install_host()
    if args.rng_startup_tick is not None:
        if not 0 <= args.rng_startup_tick < 1 << 64:
            parser.error("RNG startup control tick must fit uint64")
        oracle.install_rng_seed_control(args.rng_startup_tick)
    oracle.load()
    owners = {}
    for row in report["rows"]:
        owner = row["ownerId"]
        if row["chunk"] == 1:
            owners[owner] = oracle.initialize_movement(row, len(owners))
        applications = 2 if args.reapply_opening and row["chunk"] == 1 else 1
        row["nativeControlPositionXYZ"] = oracle.apply_position(row, *owners[owner], applications)
    report.update(
        envelopeSha256=ENVELOPE_SHA,
        nativeHostCalls=oracle.calls,
        openingApplications=2 if args.reapply_opening else 1,
        rngStartupControlTick=args.rng_startup_tick,
        scope={
            "positionReaderRva": 0x1190D20,
            "originalDispatcherLookupRva": 0x56B661,
            "nativeMovementCallbackRva": 0xAC090,
            "nativeMovementGetterRva": 0xAC070,
            "originalDispatcherPrefixExecuted": True,
            "originalSceneLookupExecuted": False,
            "nativeRngStartupRva": 0x66DA39,
            "nativeRngSeedSetterRva": 0x14BC750,
            "nativeRngSeedGlobalRva": 0x258D958,
            "recordedRngSeedReconstructed": False,
            "ownerRuntimeHistoryReconstructed": False,
            "ownedTerrainProvidersExecuted": 0,
            "rendererAdmission": False,
        },
    )
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2, allow_nan=False)


if __name__ == "__main__":
    main()
