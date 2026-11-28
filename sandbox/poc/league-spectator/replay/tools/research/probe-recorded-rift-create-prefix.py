"""Record native packet/group boundaries for the exact .8428 opcode 938 prefix."""

import argparse
import importlib.util
import json
import struct
from hashlib import sha256
from pathlib import Path

from unicorn import x86_const as reg

grouped_path = Path(__file__).with_name("extract-recorded-heimer-impacts.py")
spec = importlib.util.spec_from_file_location("recorded_grouped_creation", grouped_path)
grouped = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grouped)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--entries", action="store_true")
    parser.add_argument("--grid", action="store_true")
    args = parser.parse_args()
    binary = args.archive.read_bytes()
    if sha256(binary).hexdigest() != grouped.CURRENT_ARCHIVE_SHA256:
        raise ValueError("Unexpected exact archive digest")
    corpus = args.corpus.read_bytes()
    source = json.loads(corpus)
    if (source["build"], source["protocol"]) != (grouped.CURRENT_BUILD, grouped.PROTOCOL):
        raise ValueError("Unexpected particle packet corpus build or protocol")
    reader = grouped.GroupedReader(grouped.read_replication_image(binary, grouped.CURRENT_BUILD))
    boundaries = {}
    entry_offsets = {}
    entry_prefixes = {}
    active_group = 0
    table = reader.image.image[0x2141640:0x2141740]

    def vector_byte(byte):
        return table[grouped.rotate(table[grouped.swap(grouped.rotate(byte, 4))], 7)]

    def first_word_byte(byte):
        return grouped.swap(table[grouped.rotate(byte ^ 0x53, 2)])

    def second_word_byte(byte):
        swapped = grouped.swap(grouped.rotate((byte + 0x84) & 255, 1))
        return (grouped.swap(((swapped ^ 0x15) + 0x41) & 255) + 0x25) & 255

    def start_group(engine, *_):
        nonlocal active_group
        active_group = engine.reg_read(reg.UC_X86_REG_RDI)
        cursor = engine.reg_read(reg.UC_X86_REG_RSI)
        boundaries[active_group] = [reader.read(cursor, 8) - grouped.BODY, None]

    def read_entry_count(engine, *_):
        cursor = engine.reg_read(reg.UC_X86_REG_R15)
        boundaries[active_group][1] = reader.read(cursor, 8) - grouped.BODY

    def finish_group(engine, *_):
        row = boundaries[active_group]
        if row[1] is None:
            cursor = engine.reg_read(reg.UC_X86_REG_R15)
            row[1] = reader.read(cursor, 8) - grouped.BODY

    def start_entry(engine, *_):
        entry = engine.reg_read(reg.UC_X86_REG_RDI)
        cursor = engine.reg_read(reg.UC_X86_REG_RSI)
        entry_offsets[entry] = reader.read(cursor, 8) - grouped.BODY

    def finish_entry_prefix(engine, *_):
        entry = engine.reg_read(reg.UC_X86_REG_R15)
        cursor = engine.reg_read(reg.UC_X86_REG_R14)
        end = reader.read(cursor, 8) - grouped.BODY
        raw = engine.mem_read(entry + 8, 16)
        vector = bytes(vector_byte(byte) for byte in raw[:12])
        bits = [int.from_bytes(vector[at:at + 4], "little") for at in (0, 4, 8)]
        words = [
            int.from_bytes(bytes(projection(byte) for byte in raw[at:at + 2]), "little", signed=True)
            for at, projection in ((12, first_word_byte), (14, second_word_byte))
        ]
        entry_prefixes[entry] = [entry_offsets[entry], end, bits, words]

    reader.hook(0x1144EA0, start_group)
    reader.hook(0x116F5BD, read_entry_count)
    reader.hook(0x11454DE, finish_group)
    if args.entries:
        reader.hook(0x1140310, start_entry)
        reader.hook(0x1140888, finish_entry_prefix)
    packets = []
    entry_packets = []
    for _, sequence, context, payload in source["packets"]:
        boundaries.clear()
        entry_offsets.clear()
        entry_prefixes.clear()
        body = bytes.fromhex(payload)
        groups = reader.decode(body, context)
        if groups is None or set(groups) != boundaries.keys():
            raise ValueError(f"Unexpected archived group span at packet {sequence}")
        rows = []
        for group in groups:
            offset, entry_offset = boundaries[group]
            if entry_offset is None or not offset + 3 <= entry_offset <= len(body):
                raise ValueError(f"Bad archived group cursor at packet {sequence}")
            rows.append(
                [
                    offset,
                    entry_offset,
                    reader.field(group + 0x30, reader.key),
                    len(reader.entries(group)),
                ]
            )
        packets.append([sequence, rows])
        if args.entries:
            entries = [entry for group in groups for entry in reader.entries(group)]
            if set(entries) != entry_prefixes.keys():
                raise ValueError(f"Unexpected archived entry prefix span at packet {sequence}")
            entry_packets.append([sequence, [entry_prefixes[entry] for entry in entries]])

    optional_receipts = {"entryPrefixes": entry_packets} if args.entries else {}
    if args.entries:
        controls = []
        entry = grouped.GRID + 0x100
        boundary = reader.image.base + 0x1140888
        for first_mode in (1, 3, 6, 7):
            for second_mode in range(4):
                flags = bytes((0, 0, (first_mode & 3) << 6, first_mode >> 2, 0, second_mode << 2, 0, 0, 0, 0))
                reader.machine.mem_write(grouped.BODY, flags)
                reader.put_pointer(grouped.CURSOR, grouped.BODY)
                entry_offsets[entry] = 0
                reader.call(0x1140310, entry, grouped.CURSOR, grouped.BODY + len(flags), end=boundary)
                finish_entry_prefix(reader.machine)
                controls.append([flags.hex(), entry_prefixes[entry]])
        optional_receipts["entryPresetControls"] = controls
    if args.grid:
        for offset, coordinate in zip((0xBC, 0xC4, 0xDC, 0xE4), grouped.MAP_BOUNDS_XZ, strict=True):
            reader.machine.mem_write(grouped.GRID + offset, struct.pack("<f", coordinate))
        reader.machine.reg_write(reg.UC_X86_REG_R12, grouped.GRID)
        reader.call(0x16DB78C, end=reader.image.base + 0x16DB7E9)
        grid_bits = []
        for entry in (0x16D7AF0, 0x16D7B30):
            for word in range(-32768, 32768):
                reader.call(entry, word)
                grid_bits.append(reader.machine.reg_read(reg.UC_X86_REG_XMM0) & 0xFFFFFFFF)
        optional_receipts["grid"] = {"bounds": grouped.MAP_BOUNDS_XZ, "expectedBits": grid_bits}

    with args.output.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(
            {
                "schema": 1,
                "build": source["build"],
                "protocol": source["protocol"],
                "replaySha256": source["replaySha256"],
                "executableSha256": grouped.CURRENT_ARCHIVE_SHA256,
                "corpusSha256": sha256(corpus).hexdigest(),
                "packets": packets,
                **optional_receipts,
            },
            output,
            separators=(",", ":"),
        )
        output.write("\n")


if __name__ == "__main__":
    main()
