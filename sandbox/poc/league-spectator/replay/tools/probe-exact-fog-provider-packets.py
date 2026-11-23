"""Run exact-build readers and dispatch for recorded terrain fog providers."""

import argparse
import hashlib
import json
import struct
from collections import Counter
from pathlib import Path
from typing import ClassVar

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as reg

BUILD = "16.23.840.6595"
PROTOCOL = "8bbfcd5af2bc92db"
MACH_SHA256 = "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa"
PACKETS_SHA256 = "987cfe83d33faef500752678a5cb097b964e4fe11dbc8658e45ff321b20cb613"
REGISTER = 1158
REMOVE = 820


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ProviderPacketOracle:
    SCRATCH = 0x10000000
    STOP = SCRATCH
    PACKET = SCRATCH + 0x100
    CURSOR = SCRATCH + 0x200
    BYTES = SCRATCH + 0x1000
    DISPATCH_FRAME = SCRATCH + 0xE000
    STACK = SCRATCH + 0xF008
    ACTORS = SCRATCH + 0x10000
    PROVIDER = SCRATCH + 0x12000
    CONTROL_BLOCK = SCRATCH + 0x13000
    SERIALIZER_CONFIG = SCRATCH + 0x18000
    ACTIVE_SERIALIZER_CONFIG_RVA = 0x24E8590
    REGISTER_FACTORY = 0x1020CB0
    REMOVE_VTABLE = 0x2442F80
    READERS: ClassVar[dict[int, int]] = {REGISTER: 0x11C46F0, REMOVE: 0x11C4F30}
    DISPATCH: ClassVar[dict[int, int]] = {REGISTER: 0x6E8B8C, REMOVE: 0x6E61D6}
    ENDPOINTS: ClassVar[dict[int, int]] = {REGISTER: 0x2141B0, REMOVE: 0x215110}

    def __init__(self, image):
        self.base = image.base
        self.cpu = Uc(UC_ARCH_X86, UC_MODE_64)
        self.cpu.mem_map(self.base, (len(image.image) + 4095) & ~4095)
        self.cpu.mem_write(self.base, bytes(image.image))
        self.cpu.mem_map(self.SCRATCH, 0x20000)
        self.put_qword(self.base + self.ACTIVE_SERIALIZER_CONFIG_RVA, self.SERIALIZER_CONFIG)
        self.cpu.mem_write(self.SERIALIZER_CONFIG + 0x70, b"\x01")
        self.context = 0
        self.entity_lookups = []
        self.result = None

        # The replay envelope already supplies the base packet's encoded context.
        # Stub the entity dictionary and provider registration ownership only.
        for rva, hook in (
            (0x1637CB0, self.seed_context),
            (0x5564C0, self.find_entity),
            (0x214960, self.capture_registration),
            (0x2050A10, self.retain_control_block),
            (self.ENDPOINTS[REGISTER], self.capture_post_registration),
            (self.ENDPOINTS[REMOVE], self.capture_removal),
        ):
            address = self.base + rva
            self.cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)

        self.run(self.REGISTER_FACTORY, {reg.UC_X86_REG_RDI: self.PACKET})
        self.register_initial = bytes(self.cpu.mem_read(self.PACKET, 0x5C))
        self.remove_initial = struct.pack(
            "<QH6xI", self.base + self.REMOVE_VTABLE, REMOVE, 0x2E2E2E2E
        )

    def put_qword(self, address, value):
        self.cpu.mem_write(address, struct.pack("<Q", value))

    def get_qword(self, address):
        return struct.unpack("<Q", self.cpu.mem_read(address, 8))[0]

    def return_value(self, value):
        stack = self.cpu.reg_read(reg.UC_X86_REG_RSP)
        self.cpu.reg_write(reg.UC_X86_REG_RAX, value)
        self.cpu.reg_write(reg.UC_X86_REG_RIP, self.get_qword(stack))
        self.cpu.reg_write(reg.UC_X86_REG_RSP, stack + 8)

    def run(self, rva, registers, stop=None):
        self.put_qword(self.STACK, self.STOP)
        self.cpu.reg_write(reg.UC_X86_REG_RSP, self.STACK)
        for register, value in registers.items():
            self.cpu.reg_write(register, value)
        self.cpu.emu_start(self.base + rva, self.STOP, count=70000)
        expected_pc = self.STOP if stop is None else self.base + stop
        if self.cpu.reg_read(reg.UC_X86_REG_RIP) != expected_pc:
            raise ValueError(f"Packet path did not reach expected stop {expected_pc:#x}")

    def read_float(self, register):
        bits = self.cpu.reg_read(register) & 0xFFFFFFFF
        return struct.unpack("<f", bits.to_bytes(4, "little"))[0]

    def seed_context(self, *_):
        owner = self.cpu.reg_read(reg.UC_X86_REG_RDI)
        if owner != self.PACKET:
            raise ValueError("Base packet context escaped its receiver")
        self.cpu.mem_write(owner + 0xC, struct.pack("<I", self.context))
        self.return_value(1)

    def find_entity(self, *_):
        entity = self.cpu.reg_read(reg.UC_X86_REG_ESI)
        address = self.ACTORS + len(self.entity_lookups) * 0x100
        self.entity_lookups.append(entity)
        self.cpu.mem_write(address + 0x20, struct.pack("<I", entity))
        self.return_value(address if entity else 0)

    def capture_registration(self, *_):
        if len(self.entity_lookups) != 2:
            raise ValueError("Registration did not resolve both original entity IDs")
        stack = self.cpu.reg_read(reg.UC_X86_REG_RSP)
        destination = self.cpu.reg_read(reg.UC_X86_REG_RDI)
        position = self.cpu.reg_read(reg.UC_X86_REG_XMM0).to_bytes(16, "little")[:8]
        self.result = {
            "providerId": self.cpu.reg_read(reg.UC_X86_REG_ECX),
            "teamSlot": self.cpu.reg_read(reg.UC_X86_REG_R9D),
            "positionXZ": struct.unpack("<2f", position),
            "sourceEntityId": self.entity_lookups[0],
            "ownerId": self.entity_lookups[1],
            "registrationScalars": [
                self.read_float(register)
                for register in (
                    reg.UC_X86_REG_XMM1, reg.UC_X86_REG_XMM2,
                    reg.UC_X86_REG_XMM3, reg.UC_X86_REG_XMM4,
                )
            ],
            "registrationTag": self.cpu.reg_read(reg.UC_X86_REG_R8D),
            "registrationFlags": self.get_qword(stack + 8) & 0xFFFFFFFF,
        }
        self.cpu.mem_write(self.PROVIDER, bytes(0x88))
        self.put_qword(destination, self.PROVIDER)
        self.put_qword(destination + 8, self.CONTROL_BLOCK)
        self.return_value(destination)

    def retain_control_block(self, *_):
        control = self.cpu.reg_read(reg.UC_X86_REG_RDI)
        if control != self.CONTROL_BLOCK:
            raise ValueError("Provider ownership escaped the controlled reference")
        self.return_value(control)

    def capture_post_registration(self, *_):
        if self.result is None or self.cpu.reg_read(reg.UC_X86_REG_RDI) != self.PROVIDER:
            raise ValueError("Follow-on dispatch selected a different provider")
        self.result["postRegistrationScalars"] = [
            self.read_float(register)
            for register in (
                reg.UC_X86_REG_XMM0, reg.UC_X86_REG_XMM1, reg.UC_X86_REG_XMM2,
                reg.UC_X86_REG_XMM3, reg.UC_X86_REG_XMM4,
            )
        ]
        # Native writes before the final call. This range begins at provider +0x6C.
        self.result["postRegistrationWrites6c"] = bytes(
            self.cpu.mem_read(self.PROVIDER + 0x6C, 16)
        ).hex()
        self.cpu.emu_stop()

    def capture_removal(self, *_):
        self.result = {"providerId": self.cpu.reg_read(reg.UC_X86_REG_ESI)}
        self.cpu.emu_stop()

    def decode(self, packet):
        opcode = packet["opcode"]
        payload = bytes.fromhex(packet["payload"])
        initial = self.register_initial if opcode == REGISTER else self.remove_initial
        self.context = packet["context"]
        self.entity_lookups = []
        self.result = None
        self.put_qword(self.CURSOR, self.BYTES)
        self.cpu.mem_write(self.PACKET, initial)
        self.cpu.mem_write(self.BYTES, payload)
        payload_end = self.BYTES + len(payload)
        self.run(
            self.READERS[opcode],
            {
                reg.UC_X86_REG_RDI: self.PACKET,
                reg.UC_X86_REG_RSI: self.CURSOR,
                reg.UC_X86_REG_RDX: payload_end,
            },
        )
        success = self.cpu.reg_read(reg.UC_X86_REG_RAX) & 0xFF
        if success != 1 or self.get_qword(self.CURSOR) != payload_end:
            raise ValueError(
                f"Reader failed to consume opcode {opcode} "
                f"at chunk {packet['chunk']} offset {packet['offset']}"
            )
        self.run(
            self.DISPATCH[opcode],
            {reg.UC_X86_REG_RSI: self.PACKET, reg.UC_X86_REG_RBP: self.DISPATCH_FRAME},
            stop=self.ENDPOINTS[opcode],
        )
        if self.result is None:
            raise ValueError("Packet dispatch produced no provider receipt")
        return self.result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("macos_executable", type=Path)
    parser.add_argument("packets", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    image = MachImage(args.macos_executable.read_bytes())
    if sha(image.binary) != MACH_SHA256:
        raise ValueError(f"Expected the exact {BUILD} x86-64 Mach-O slice")
    packet_bytes = args.packets.read_bytes()
    if sha(packet_bytes) != PACKETS_SHA256:
        raise ValueError("Expected the pinned provider envelope extract from both saved replays")
    evidence = json.loads(packet_bytes)
    if (evidence["build"], evidence["protocol"]) != (BUILD, PROTOCOL):
        raise ValueError("Provider packet build or protocol mismatch")
    short, long = (fixture["match"] for fixture in evidence["fixtures"])
    expected_counts = {
        (short, 1, REGISTER): 136,
        (short, 2, REGISTER): 84,
        (short, 1, REMOVE): 11,
        (long, 1, REGISTER): 10688,
        (long, 2, REGISTER): 2788,
        (long, 1, REMOVE): 1129,
    }
    oracle = ProviderPacketOracle(image)
    counts = Counter()
    decoded = []
    for packet in evidence["rows"]:
        counts[packet["match"], packet["stream"], packet["opcode"]] += 1
        fields = oracle.decode(packet)
        association = {key: value for key, value in packet.items() if key != "payload"}
        decoded.append({**association, **fields})
    if counts != expected_counts:
        raise ValueError("Native reader census differs from the saved replay evidence")

    receipt = {
        "build": BUILD,
        "protocol": PROTOCOL,
        "machSliceSha256": MACH_SHA256,
        "packetExtractSha256": PACKETS_SHA256,
        "fixtures": evidence["fixtures"],
        "counts": [
            {"match": match, "stream": stream, "opcode": opcode, "packets": count}
            for (match, stream, opcode), count in sorted(counts.items())
        ],
        "scope": {
            "exactNativePacketConsumption": True,
            "exactProviderInputDispatch": True,
            "nativeEntityLookupExecuted": False,
            "nativeProviderRegistryReconstructed": False,
            "nativeOwnerModifiersRecovered": False,
            "matchTerrainGridReconstructed": False,
            "recordedPositionUpdate985Packets": 0,
        },
        "rows": decoded,
    }
    receipt_bytes = (
        json.dumps(receipt, allow_nan=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    with args.output.open("xb") as output:
        output.write(receipt_bytes)
    print(sha(receipt_bytes))


if __name__ == "__main__":
    main()
