"""Bind the recorded Bloom opening turret names using the archived reader."""

import argparse
import json
import re
import runpy
from hashlib import sha256
from pathlib import Path


CONSTRUCTOR = 0x101FE30
BODY_READER = 0x103E630
VTABLE = 0x24386A0
CENSUS_DIGESTS = {
    "openingPackets": "bdb7b51c1039bf89a34041fc6cdf98c8f1b84aa889aacd303a934f3964838ac5",
    "authoredStructures": "e15009f7c6e509e9ea434ed6d4c5d68b4aab23fac339ca788f93aa0f8a6b61f4",
}
SOURCE_DIGESTS = {
    "replaySha256": "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7",
    "materialsSha256": "edda022b5e925b62ccf05430623e339873cb06a67e7a6ef02764a5a3552f683b",
    "mapSha256": "b0734c4fee0360593108147bb8ab62525607debff30c1eb17c60859009c5a57d",
}


def bind_turrets(archive, census):
    for field, digest in SOURCE_DIGESTS.items():
        if census[field] != digest:
            raise ValueError(f"Bloom structure source differs at {field}")
    for field, digest in CENSUS_DIGESTS.items():
        encoded = json.dumps(census[field], separators=(",", ":")).encode()
        if sha256(encoded).hexdigest() != digest:
            raise ValueError(f"Bloom structure census differs at {field}")

    harness = runpy.run_path(
        str(Path(__file__).with_name("extract-recorded-heimer-impacts.py"))
    )
    image = harness["read_replication_image"](archive, harness["CURRENT_BUILD"])
    reader = harness["GroupedReader"](image)
    registers = harness["r"]
    packet = harness["OBJECT"]
    cursor = harness["CURSOR"]
    body = harness["BODY"]
    placements = {row["mapNameHash"]: row for row in census["authoredStructures"]}
    bindings = []

    for row in census["openingPackets"]:
        context = row["context"]
        payload = bytes.fromhex(row["namePayload"])
        reader.machine.mem_write(harness["STOP"], harness["EMPTY"])
        reader.heap = harness["HEAP"]
        reader.context = context
        reader.call(CONSTRUCTOR, packet)
        if (
            reader.read(packet, 8) != image.base + VTABLE
            or reader.read(image.base + VTABLE + 8, 8) != image.base + BODY_READER
            or reader.read(packet + 8, 2) != 921
        ):
            raise ValueError("Archived opening name packet constructor differs")

        reader.machine.mem_write(body, payload)
        reader.put_pointer(cursor, body)
        reader.call(BODY_READER, packet, cursor, body + len(payload))
        if (
            reader.read(cursor, 8) != body + len(payload)
            or reader.machine.reg_read(registers.UC_X86_REG_AL) != 1
            or reader.read(packet + 12, 4) != context
        ):
            raise ValueError("Native reader did not consume the complete opening name")

        address = reader.read(packet + 0x18, 8)
        if address != harness["HEAP"] or reader.heap < address + 32:
            raise ValueError("Opening name buffer differs from the reader allocation")
        raw = bytes(reader.machine.mem_read(address, min(reader.heap - address, 64)))
        name, terminator, _ = raw.partition(b"\0")
        if not terminator:
            raise ValueError("Native opening name lacks a terminator")
        name = name.decode("ascii")
        parts = re.fullmatch(r"Turret_T(Order|Chaos)_L1_P[02345]_(\d{8,10})_0", name)
        if not parts:
            raise ValueError(f"Unexpected native turret opening name {name}")
        map_name = int(parts[2])
        placement = placements.pop(map_name, None)
        if placement is None:
            raise ValueError("Missing or repeated authored placement for native turret")
        bindings.append(
            {
                "context": context,
                "nativeName": name,
                "nativeBytesConsumed": len(payload),
                **placement,
            }
        )

    if len(bindings) != 10 or any(
        not row["skin"].startswith(("Characters/Nexus/", "Characters/Inhibitor/"))
        for row in placements.values()
    ):
        raise ValueError("The native Bloom turret cohort is incomplete")
    return {
        "kind": "mayhem-bloom-native-turret-opening",
        "archiveSha256": sha256(archive).hexdigest(),
        **SOURCE_DIGESTS,
        "opcode": 921,
        "constructorRva": CONSTRUCTOR,
        "bodyReaderRva": BODY_READER,
        "bindings": bindings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("census", type=Path)
    args = parser.parse_args()
    bindings = bind_turrets(args.archive.read_bytes(), json.loads(args.census.read_text()))
    print(json.dumps(bindings, indent=2))


if __name__ == "__main__":
    main()
