"""Capture the exact .8428 opcode 938 reader pages and native identity oracle."""

import argparse
import json
import runpy
import struct
from hashlib import sha256
from pathlib import Path

from unicorn import UC_HOOK_BLOCK, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE

RESOURCE_KEY = 0x6BB08197
WIRE_KEY = bytes.fromhex("0252551bc7")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("corpora", type=Path, nargs="+")
    parser.add_argument(
        "--senna-ground-hit-only", action="store_true",
        help="Capture only bodies with the canonical Senna ground-hit resource varint",
    )
    args = parser.parse_args()
    source_path = Path(__file__).resolve()
    output = args.output.resolve()
    if source_path.parents[6] / ".cache" not in output.parents:
        raise ValueError("Effect capture output must use a new private cache directory")
    source = runpy.run_path(str(source_path.with_name("extract-recorded-heimer-impacts.py")))
    archive = args.archive.read_bytes()
    if sha256(archive).hexdigest() != source["CURRENT_ARCHIVE_SHA256"]:
        raise ValueError("Wrong archived Rift creation reader")
    image = source["read_replication_image"](archive, source["CURRENT_BUILD"])
    reader = source["GroupedReader"](image)
    pages = set()
    imports = set()

    def record(address, size):
        offset = address - image.base
        if 0 <= offset and offset + size <= len(image.image):
            pages.update(range(offset & ~0xFFF, offset + size, 0x1000))

    def block(_cpu, address, size, _):
        record(address, size)

    def memory(_cpu, _access, address, size, _value, _):
        record(address, size)

    def imported(_cpu, address, _size, _):
        imports.add(address - image.base)

    image_end = image.base + len(image.image) - 1
    reader.machine.hook_add(UC_HOOK_BLOCK, block, begin=image.base, end=image_end)
    reader.machine.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, memory, begin=image.base, end=image_end)
    for address in image.imports:
        reader.hook(address, imported)
    guard = [rva for rva, name in image.data_imports.items() if name == "___stack_chk_guard"]
    for rva in [*guard, 0x24E8590, 0x2141640]:
        record(image.base + rva, 8)

    witnesses = []
    for path in args.corpora:
        corpus = json.loads(path.read_bytes())
        if (corpus["build"], corpus["protocol"], corpus["opcode"]) != (
            source["CURRENT_BUILD"], source["PROTOCOL"], 938
        ):
            raise ValueError("Unexpected opcode 938 corpus identity")
        digest = sha256()
        packet_count = group_count = entry_count = candidate_count = 0
        for _, sequence, context, body in corpus["packets"]:
            payload = bytes.fromhex(body)
            if args.senna_ground_hit_only and WIRE_KEY not in payload:
                continue
            packet_count += 1
            addresses = reader.decode(payload, context)
            if addresses is None:
                raise ValueError(f"Incomplete original opcode 938 body at {sequence}")
            groups = []
            for group in addresses:
                key = reader.field(group + 0x30, reader.key)
                if key == RESOURCE_KEY and WIRE_KEY not in payload:
                    raise ValueError("Native candidate omitted by the encoded resource filter")
                entries = []
                for entry in reader.entries(group):
                    handle = reader.field(entry + 0x98, reader.handle)
                    owner = reader.field(entry + 0x70, reader.owner)
                    parent = reader.field(entry + 0xA0, reader.parent)
                    descriptor = None
                    if key == RESOURCE_KEY and parent == context == 0:
                        placement = reader.placement(group, entry, handle, owner, key)
                        components = [
                            value for xyz in [*placement["positions"], placement["scaleRate"]]
                            for value in xyz
                        ]
                        bit_patterns = struct.unpack("<11I", struct.pack("<11f", *components))
                        descriptor = [placement["flags"], *bit_patterns]
                        candidate_count += 1
                    entries.append([handle, owner, parent, descriptor])
                group_count += 1
                entry_count += len(entries)
                groups.append([key, entries])
            digest.update((json.dumps([sequence, groups], separators=(",", ":")) + "\n").encode())
        witnesses.append({
            "replaySha256": corpus["replaySha256"],
            "packets": packet_count,
            "groups": group_count,
            "entries": entry_count,
            "candidates": candidate_count,
            "identitySha256": digest.hexdigest(),
        })

    ordered = sorted(pages)
    page_bytes = b"".join(bytes(image.image[page : page + 0x1000]) for page in ordered)
    profile = {
        "base": image.base,
        "pages": ordered,
        "guard": guard,
        "imports": {rva: image.imports[rva] for rva in sorted(imports)},
        "archiveSha256": sha256(archive).hexdigest(),
        "pageSha256": sha256(page_bytes).hexdigest(),
    }
    output.mkdir()
    (output / "pages.bin").write_bytes(page_bytes)
    (output / "profile.json").write_bytes(json.dumps(profile, indent=2).encode())
    (output / "witnesses.json").write_bytes(json.dumps(witnesses, indent=2).encode())
    print(json.dumps({"pages": len(ordered), "sha256": profile["pageSha256"], "witnesses": witnesses}))


if __name__ == "__main__":
    main()
