"""Execute the exact .8428 turret group reader and virtual health getters."""

import argparse
import json
import runpy
import struct
from collections import Counter
from hashlib import sha256
from pathlib import Path


def prove(archive, evidence):
    evidence_digest = sha256(evidence).hexdigest()
    if evidence_digest != "95fc08cd571080ec5fff27707dbcfe62a655d1c7aa95850c4009bc11c6d19f7c":
        raise ValueError("Expected the exact recorded Bloom turret health census")
    harness = runpy.run_path(
        str(Path(__file__).with_name("extract-recorded-heimer-impacts.py"))
    )
    image = harness["read_replication_image"](archive, harness["CURRENT_BUILD"])
    reader = harness["GroupedReader"](image)
    registers = harness["r"]
    entity = harness["STOP"] + 0x20000
    reader.heap = harness["HEAP"]
    vtable = image.base + 0x23798F0
    reader.put_pointer(entity, vtable)
    # Check the archived turret constructor's publication of this same vtable.
    constructor_store = 0x1BE21A
    if image.image[constructor_store : constructor_store + 3] != b"\x48\x8d\x05":
        raise ValueError("Archived turret constructor vtable load differs")
    offset = struct.unpack_from("<i", image.image, constructor_store + 3)[0]
    if image.base + constructor_store + 7 + offset != vtable:
        raise ValueError("Archived turret constructor vtable differs")
    reader.machine.mem_write(image.base + 0x25D4B08, b"\x01\0\0")
    reader.call(0x1AECF0, entity)
    group = image.base + 0x250B080
    if (
        reader.read(group, 4) != 16
        or reader.read(group + 8, 8) != 0xFBFF
        or [reader.read(group + offset, 4) for offset in (16, 20)] != [0x920, 0x948]
        or [reader.read(vtable + slot, 8) - image.base for slot in (0x6D8, 0x710)]
        != [0xCD200, 0xCD1E0]
    ):
        raise ValueError("Archived turret health registration differs")
    cursor = harness["CURSOR"]
    body = harness["BODY"]
    reader.put_pointer(cursor, group)
    counts = Counter()
    for row in json.loads(evidence)["groups"]:
        raw = bytes.fromhex(row["bytes"])
        mask = row["fieldMask"] & 3
        reader.machine.mem_write(body, raw + bytes(8))
        reader.machine.reg_write(registers.UC_X86_REG_RCX, body)
        reader.call(0x1D7700, cursor, entity, mask)
        if reader.machine.reg_read(registers.UC_X86_REG_RAX) != row["prefixBytes"]:
            raise ValueError("Original turret reader consumed a different prefix")
        for name, flag, getter in (("current", 1, 0xCD200), ("max", 2, 0xCD1E0)):
            if mask & flag:
                reader.call(getter, entity)
                bits = reader.machine.reg_read(registers.UC_X86_REG_XMM0) & 0xFFFFFFFF
                if struct.pack("<I", bits) != struct.pack("<f", row["values"][name]):
                    raise ValueError(f"Original turret getter disagrees for {name}")
        counts[row["stream"]] += 1
    return {
        "kind": "bloom-native-turret-health",
        "evidenceSha256": evidence_digest,
        "archiveSha256": sha256(archive).hexdigest(),
        "agreementByStream": dict(counts),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("census", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    receipt = prove(args.archive.read_bytes(), args.census.read_bytes())
    # Preserve the reviewed receipt bytes independently of the host platform.
    data = json.dumps(receipt, indent=2).replace("\n", "\r\n").encode("utf8")
    with args.output.open("xb") as output:
        output.write(data)


if __name__ == "__main__":
    main()
