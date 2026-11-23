"""Execute the archived opcode 840 reader and field consumer for saved replays."""

import argparse
import hashlib
import json
import struct
from pathlib import Path

from macho import MachImage
from unicorn import UC_ARCH_X86, UC_MODE_64, Uc
from unicorn import x86_const as reg

ARCHIVE = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
SOURCES = {
    "8a330e97524c05232b82abaac5b6ca7c7b1644d2eedaca46ee958cf95793fe77": (276, 39728, [73325, 73370], [1054, 2003]),
    "4e9d7f2943f8ec261262415206d36ba461900453b2ab242d3311f27828065882": (48, 39983, [69125, 69149], [1055, 2003]),
}
MUTATIONS = {
    "set": (840, 0x1738EB, 0x17393F, 0x174C80),
    "count": (797, 0x1739B4, 0x173A08, 0x175330),
    "swap": (226, 0x173A7D, 0x173AD1, 0x1754A0),
    "stack": (1143, 0x173B46, 0x173B9A, 0x175520),
    "snapshot": (415, 0x173C0F, 0x173C63, 0x175650),
    "checkpointSnapshot": (1214, 0x173CD8, 0x173D2C, 0x175670),
    "replacement": (190, 0x173F33, 0x173F87, 0x1758A0),
    "counter": (248, 0x173FFC, 0x174050, 0x175F20),
}
ARENA = 0x6000000
STOP = ARENA
OBJECT = ARENA + 0x1000
CURSOR = ARENA + 0x2000
DATA = ARENA + 0x3000
STACK = ARENA + 0x7FF8


def context_encoder(image):
    table = image[0x2156E30:0x2156F30]

    def rotate(value):
        return ((value << 1) | (value >> 7)) & 255

    inverse = {table[table[rotate((table[value ^ 255] + 0x54) & 255)] + 0xB4 & 255]: value for value in range(256)}
    if len(inverse) != 256:
        raise ValueError("Native context encoding table must be bijective")

    def encode(context):
        value = context ^ 0x40000000 if context & 0xFFFFFF else context
        output = bytearray()
        while value >= 128:
            output.append(inverse[(value & 127) | 128])
            value >>= 7
        output.append(inverse[value])
        return bytes(output)

    return encode


def read_rows(image, rows):
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    u.mem_map(image.base, len(image.image))
    u.mem_write(image.base, bytes(image.image))
    u.mem_map(ARENA, 0x8000)
    encode = context_encoder(image.image)

    def run(start, registers, stop=STOP):
        u.mem_write(STACK, struct.pack("<Q", STOP))
        u.reg_write(reg.UC_X86_REG_RSP, STACK)
        for register, value in registers.items():
            u.reg_write(register, value)
        u.emu_start(image.base + start, stop, count=40_000)
        if u.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError("Native inventory execution exceeded its expected boundary")

    for row in rows:
        context = row["context"]
        body = encode(context) + bytes.fromhex(row["body"])
        if len(body) > 1024:
            raise ValueError("Inventory set body exceeds probe capacity")
        u.mem_write(OBJECT, bytes(144))
        u.mem_write(CURSOR, struct.pack("<Q", DATA))
        u.mem_write(DATA, body)
        run(0x101FC00, {reg.UC_X86_REG_RDI: OBJECT})
        run(
            0x119D510,
            {reg.UC_X86_REG_RDI: OBJECT, reg.UC_X86_REG_RSI: CURSOR, reg.UC_X86_REG_RDX: DATA + len(body)},
        )
        if (
            u.reg_read(reg.UC_X86_REG_AL) != 1
            or struct.unpack("<Q", u.mem_read(CURSOR, 8))[0] != DATA + len(body)
            or struct.unpack("<H2xI", u.mem_read(OBJECT + 8, 8)) != (840, context)
        ):
            raise ValueError("Native inventory reader did not consume the recorded update")
        run(
            0x174EEC,
            {reg.UC_X86_REG_RBX: OBJECT, reg.UC_X86_REG_R12: image.base + 0x2135FA0},
            image.base + 0x1750DA,
        )
        slot, item_id, count = [
            u.reg_read(register) for register in (reg.UC_X86_REG_ESI, reg.UC_X86_REG_EDX, reg.UC_X86_REG_ECX)
        ]
        if slot >= 39:
            raise ValueError("Native slot guard would reject decoded update")
        yield {
            **{key: value for key, value in row.items() if key != "body"},
            "slot": slot,
            "itemId": item_id,
            "count": count,
        }


def registered_mutation_counts(image, opcodes_by_stream):
    channels = {}
    for name, (opcode, handler_load, opcode_load, handler) in MUTATIONS.items():
        if (
            image[handler_load : handler_load + 3] != b"\x48\x8d\x0d"
            or handler_load + 7 + struct.unpack_from("<i", image, handler_load + 3)[0] != handler
            or image[opcode_load] != 0xBA
            or struct.unpack_from("<I", image, opcode_load + 1)[0] != opcode
        ):
            raise ValueError(f"Native inventory registration for {name} changed")
        channels[name] = {
            "opcode": opcode,
            "handlerRva": handler,
            "handlerRegistrationRva": handler_load,
            "opcodeRegistrationRva": opcode_load,
            "rosterCountsByStream": {
                stream: counts.get(str(opcode), 0) for stream, counts in opcodes_by_stream.items()
            },
        }
    return channels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "source", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    source_bytes = args.source.read_bytes()
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    if source_sha not in SOURCES:
        raise ValueError("Unrecognized exact replay census input")
    image_bytes = args.archive.read_bytes()
    if hashlib.sha256(image_bytes).hexdigest() != ARCHIVE:
        raise ValueError("Wrong archived inventory build")
    source = json.loads(source_bytes)
    image = MachImage(image_bytes)
    rows = list(read_rows(image, source["rows"]))
    expected_count, chunk, offsets, item_ids = SOURCES[source_sha]
    proof = [row for row in rows if row["chunkOffset"] == chunk and row["blockOffset"] in offsets]
    if len(rows) != expected_count or [row["itemId"] for row in proof] != item_ids:
        raise ValueError("Native set observations disagree with the expected census and spend")
    if [(row["slot"], row["count"]) for row in proof] != [(0, 1), (1, 1)]:
        raise ValueError("Native spend witness does not write both expected slots")
    gold = [
        spend
        for spend in source["spends"]
        if spend["participantId"] == proof[0]["context"]
        and 0 <= spend["timeSeconds"] - proof[0]["timeSeconds"] < 0.1
        and (spend["before"], spend["after"]) == (500, 0)
    ]
    if len(gold) != 1:
        raise ValueError("Expected exactly one recorded 500-to-zero gold change")
    result = {
        **{key: source[key] for key in ("build", "protocol", "replaySha256", "goldSha256", "streamCounts")},
        "sourceSha256": source_sha,
        "archiveSha256": ARCHIVE,
        "inventorySetOpcode": 840,
        "nativeRvas": {
            "constructor": 0x101FC00,
            "wireReader": 0x119D510,
            "fieldReader": 0x174EEC,
            "beforeSetter": 0x1750DA,
        },
        "spendWitness": {"slotWrites": proof, "gold": gold[0]},
        "registeredMutationChannels": registered_mutation_counts(image.image, source["rosterOpcodesByStream"]),
        "rows": rows,
        "scope": {
            "allObservedOpcode840Decoded": True,
            "exactItemPriceSourceRecovered": False,
            "completeInventoryMutationChannels": False,
            "originalSlotMutationExecuted": False,
        },
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
