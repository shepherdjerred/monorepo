"""Record native packet/group boundaries for the exact .8428 opcode 938 prefix."""

import argparse
import importlib.util
import json
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
    active_group = 0

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

    reader.hook(0x1144EA0, start_group)
    reader.hook(0x116F5BD, read_entry_count)
    reader.hook(0x11454DE, finish_group)
    packets = []
    for _, sequence, context, payload in source["packets"]:
        boundaries.clear()
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
            },
            output,
            separators=(",", ":"),
        )
        output.write("\n")


if __name__ == "__main__":
    main()
