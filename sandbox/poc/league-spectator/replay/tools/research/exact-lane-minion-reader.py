"""Run the saved exact Mach-O packet readers against archived packet bodies."""

import hashlib
import json
import struct
import sys
from pathlib import Path

import unicorn
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage


def rotate(byte, count):
    return ((byte << count) | (byte >> (8 - count))) & 255


def swap_pairs(byte):
    return ((byte >> 1) & 0x55) | ((byte << 1) & 0xAA)


def initialize(size, fields):
    result = bytearray(size)
    for offset, value in fields:
        value = bytes.fromhex(value)
        result[offset : offset + len(value)] = value
    return result


def main():
    archive, *options = sys.argv[1:]
    if options not in ([], ["--first-wave-8428"], ["--corroborated-waves-8428"]):
        raise ValueError("Expected the exact archive and an optional current-build lane profile")
    binary = Path(archive).read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    expected = (
        "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
        if options
        else "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
    )
    if digest != expected:
        raise ValueError("Expected the reviewed executable bytes for the lane profile")
    image = MachImage(binary)
    table = image.image[0x21485C0:0x21486C0]
    runtime = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    runtime.mem_map(image.base, len(image.image))
    runtime.mem_write(image.base, bytes(image.image))
    runtime.mem_map(0x10000000, 0x10000)
    stop, obj, cursor, body, stack = (0x10000000, 0x10000100, 0x10000200, 0x10001000, 0x1000F008)

    def supply_envelope_context(engine, _address, _size, context):
        # The archived envelope already owns the context field. Start the
        # native structural reader's field cursor at the archived body.
        pointer = engine.reg_read(reg.UC_X86_REG_RSP)
        engine.mem_write(obj + 12, struct.pack("<I", context))
        engine.reg_write(reg.UC_X86_REG_RAX, 1)
        engine.reg_write(reg.UC_X86_REG_RSP, pointer + 8)
        engine.reg_write(reg.UC_X86_REG_RIP, struct.unpack("<Q", engine.mem_read(pointer, 8))[0])

    entry = image.base + 0x1637CB0

    lane_init = initialize(
        0x2C,
        [
            (8, "bd00"),
            (0x10, "e463"),
            (0x14, "bb" * 4),
            (0x18, "98"),
            (0x1A, "1414"),
            (0x1C, "b0" * 4),
            (0x20, "3c3c"),
            (0x24, "07" * 4),
            (0x28, "33"),
        ],
    )
    death_init = initialize(
        0x58,
        [
            (8, "ad04"),
            (0x14, "7e" * 12),
            (0x20, "89" * 4),
            (0x2C, "2283"),
            (0x30, "bc" * 4),
            (0x34, "52" * 12),
            (0x50, "cc" * 4),
            (0x54, "75"),
        ],
    )
    struct.pack_into("<Q", death_init, 0x24, image.base + 0x2437E68)
    death_init[0x40:0x50] = image.image[0x2148090:0x21480A0]
    removal_init = initialize(0x14, [(8, "7500"), (0x10, "4a" * 4)])
    readers = {189: (0x1387220, lane_init), 1197: (0x1036720, death_init), 117: (0x11932D0, removal_init)}

    def read_object(opcode, context, payload):
        if not 1 <= len(payload) <= 0x1000:
            raise ValueError("Invalid lane packet length")
        start, initial = readers[opcode]
        runtime.mem_write(obj, bytes(initial))
        runtime.mem_write(cursor, struct.pack("<Q", body))
        runtime.mem_write(body, payload)
        runtime.mem_write(stack, struct.pack("<Q", stop))
        for register, value in [
            (reg.UC_X86_REG_RDI, obj),
            (reg.UC_X86_REG_RSI, cursor),
            (reg.UC_X86_REG_RDX, body + len(payload)),
            (reg.UC_X86_REG_RSP, stack),
        ]:
            runtime.reg_write(register, value)
        hook = runtime.hook_add(unicorn.UC_HOOK_CODE, supply_envelope_context, context, begin=entry, end=entry)
        try:
            runtime.emu_start(image.base + start, stop, count=10000)
        finally:
            runtime.hook_del(hook)
        if (
            runtime.reg_read(reg.UC_X86_REG_RIP) != stop
            or runtime.reg_read(reg.UC_X86_REG_RAX) & 255 != 1
            or struct.unpack("<Q", runtime.mem_read(cursor, 8))[0] != body + len(payload)
        ):
            raise ValueError(f"Native reader declined opcode {opcode}, context {context}")
        return bytes(runtime.mem_read(obj, len(initial)))

    def word(raw, offset, length, decode):
        return int.from_bytes(bytes(map(decode, raw[offset : offset + length])), "little")

    decoded = []
    for opcode, context, payload_hex in json.load(sys.stdin):
        payload = bytes.fromhex(payload_hex)
        if opcode == 66:
            if len(payload) != 2 or payload[0] != 0x77:
                raise ValueError("Unsupported opening team observation")
            ordinal = table[swap_pairs(table[rotate(payload[1], 5) ^ 0xFF] ^ 0x71)]
            decoded.append({"teamOrdinal": ordinal})
            continue
        raw = read_object(opcode, context, payload)
        if opcode == 189:
            # The lane barracks consumer reads +0x18 for type, +0x14 for
            # entity, and dispatch 0x6f2633 resolves +0x1c as its parent.
            decoded.append(
                {
                    "entity": word(raw, 0x14, 4, lambda b: (table[(rotate(b ^ 255, 7) + 0x4E) & 255] + 0x41) & 255),
                    "unitType": (0xBD - rotate(swap_pairs(((swap_pairs(raw[0x18]) + 0x32) & 255) ^ 9), 2)) & 255,
                    "barracks": word(
                        raw, 0x1C, 4, lambda b: table[(rotate(table[swap_pairs((b + 0x4F) & 255)], 4) + 0xB8) & 255]
                    ),
                }
            )
        elif opcode == 1197:
            decoded.append(
                {"relatedEntity": word(raw, 0x50, 4, lambda b: table[table[table[(0xEA - b) & 255]] ^ 0x17])}
            )
        else:
            decoded.append(
                {"entity": word(raw, 0x10, 4, lambda b: (0x88 - rotate(((rotate(b, 4) ^ 0xD2) + 0xCE) & 255, 1)) & 255)}
            )
    print(
        json.dumps(
            {"decoderSha256": digest, "creationTableSha256": hashlib.sha256(table).hexdigest(), "decoded": decoded}
        )
    )


if __name__ == "__main__":
    main()
