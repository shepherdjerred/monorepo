"""Trace the archived registration, packet readers, and team-mask writes."""

import argparse
import hashlib
import json
import runpy
import struct
from pathlib import Path

from unicorn import UC_HOOK_MEM_WRITE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("discovery_receipt", type=Path)
    parser.add_argument("receipt_sha256")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Run with assertions enabled")
    source = args.discovery_receipt.read_bytes()
    assert hashlib.sha256(source).hexdigest() == args.receipt_sha256
    discovery = json.loads(source)
    assert discovery["kind"] == "reviewed-native-maokai-r-launch-discovery"
    packets = {
        (packet["opcode"], packet["bodySha256"]): case["identity"]["entity"]
        for case in discovery["candidates"]
        for packet in case["subsequentPackets"]
        if packet["bodyBytes"] == 2
    }

    support = runpy.run_path(str(Path(__file__).with_name("extract-recorded-heimer-impacts.py")))
    image = support["read_replication_image"](args.executable.read_bytes(), support["CURRENT_BUILD"])
    reader = support["GroupedReader"](image)
    registers = support["r"]
    cpu, base = reader.machine, image.base
    owner, dispatcher = support["CONFIG"], support["GRID"]
    frame, provider = (support["STOP"] + offset for offset in (0x8000, 0x9000))
    reader.put_pointer(base + 0x24E8590, provider)
    cpu.mem_write(provider + 0x70, b"\x01")
    registrations = {}

    def observe_registration(engine, *_):
        first, second, opcode, functor = (
            engine.reg_read(register)
            for register in (
                registers.UC_X86_REG_RDI,
                registers.UC_X86_REG_RSI,
                registers.UC_X86_REG_RDX,
                registers.UC_X86_REG_RCX,
            )
        )
        assert first == dispatcher + 8 and second == owner and reader.read(functor + 8, 8) == owner
        registrations[opcode] = reader.read(functor + 16, 8) - base
        reader.return_value(0)

    reader.hook(0x6D5C40, observe_registration)
    for start, end in ((0x21FB82, 0x21FBF8), (0x21FC64, 0x21FCDA)):
        for register, value in (
            (registers.UC_X86_REG_RBP, frame),
            (registers.UC_X86_REG_RSP, frame - 0x400),
            (registers.UC_X86_REG_RDI, dispatcher),
            (registers.UC_X86_REG_RBX, owner),
            (registers.UC_X86_REG_R14, frame - 0x60),
        ):
            cpu.reg_write(register, value)
        cpu.emu_start(base + start, base + end, count=100)
        assert cpu.reg_read(registers.UC_X86_REG_RIP) == base + end
    assert registrations == {66: 0x21FE40, 696: 0x21FE80}

    results = []
    for opcode, constructor, packet_reader, initial, variants in (
        (66, 0x101A348, 0x112DF10, 0, ((b"\x77\x8f", 2), (b"\x77\xdb", 4))),
        (696, 0x10112EB, 0x112DFA0, 6, ((b"\x77\x8f", 2),)),
    ):
        for payload, bit in variants:
            digest = hashlib.sha256(payload).hexdigest()
            reader.context = packets[opcode, digest]
            reader.heap = support["HEAP"]
            cpu.reg_write(registers.UC_X86_REG_RBX, support["OBJECT"])
            reader.call(constructor, end=base + 0x101C304)
            packet = reader.read(support["OBJECT"], 8)
            assert reader.read(packet + 8, 2) == opcode
            assert reader.read(reader.read(packet, 8) + 8, 8) == base + packet_reader
            body, cursor = support["BODY"], support["CURSOR"]
            cpu.mem_write(body, payload)
            reader.put_pointer(cursor, body)
            reader.call(packet_reader, packet, cursor, body + len(payload))
            assert reader.read(cursor, 8) == body + len(payload) and cpu.reg_read(registers.UC_X86_REG_AL) == 1
            cpu.mem_write(owner, bytes([0xA5]) * 0x80)
            cpu.mem_write(owner + 0x24, struct.pack("<I", initial))
            writes = []
            hook = cpu.hook_add(
                UC_HOOK_MEM_WRITE,
                lambda _, _kind, address, size, value, _data, writes=writes: writes.append(
                    (address - owner, size, value)
                ),
                begin=owner,
                end=owner + 0x7F,
            )
            try:
                reader.call(registrations[opcode], owner, packet)
            finally:
                cpu.hook_del(hook)
            expected = bit if opcode == 66 else initial & ~bit
            assert writes == [(0x24, 4, expected)] and reader.read(owner + 0x24, 4) == expected
            results.append({"opcode": opcode, "packetSha256": digest, "initial": initial, "final": expected})
    print(json.dumps({"discoverySha256": args.receipt_sha256, "registrations": registrations, "cases": results}))


if __name__ == "__main__":
    main()
