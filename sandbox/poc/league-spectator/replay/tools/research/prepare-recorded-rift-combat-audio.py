"""Derive the replay-bound Senna W dry cue receipt from the original Rift packet corpus.

Use prepare-recorded-particle-packets.mjs --opcode 938 to extract the corpus
from the original ROFL. The archive and corpus stay local.
"""

import argparse
import json
import runpy
from hashlib import sha256
from pathlib import Path

CORPUS_SHA256 = "e16c17c8772f628d7a1ba2fed2b9bffbb66b8b887818ce20c9e8aaf6744f2a7c"
RESOURCE_KEY = 0x6BB08197
SENNA_OWNER = 1073742165
MEDIA_ID = 329446178


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("packets", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not args.output.parent.resolve().is_relative_to(Path(".cache").resolve()):
        parser.error("Expected a fresh private .cache output")

    corpus_bytes = args.packets.read_bytes()
    if sha256(corpus_bytes).hexdigest() != CORPUS_SHA256:
        raise ValueError("Wrong original Rift creation corpus")
    corpus = json.loads(corpus_bytes)
    native = runpy.run_path(str(Path(__file__).with_name("extract-recorded-heimer-impacts.py")))
    archive_bytes = args.archive.read_bytes()
    archive_digest = sha256(archive_bytes).hexdigest()
    if archive_digest != native["CURRENT_ARCHIVE_SHA256"]:
        raise ValueError("Wrong archived Rift creation reader")
    image = native["read_replication_image"](archive_bytes, corpus["build"])
    reader = native["GroupedReader"](image)

    # This resource key is outside the four opcode 938 constructor presets.
    # A group must explicitly encode it with this varint. The native reader
    # still checks the full body, group key, entry and placement on every hit.
    wire_key = bytes.fromhex("0252551bc7")
    events = []
    for stamp, sequence, context, encoded in corpus["packets"]:
        payload = bytes.fromhex(encoded)
        if wire_key not in payload:
            continue
        groups = reader.decode(payload, context)
        if groups is None:
            raise ValueError(f"Incomplete grouped body at packet {sequence}")
        for group in groups:
            key = reader.field(group + 0x30, reader.key)
            if key != RESOURCE_KEY:
                continue
            for entry in reader.entries(group):
                owner = reader.field(entry + 0x70, reader.owner)
                parent = reader.field(entry + 0xA0, reader.parent)
                handle = reader.field(entry + 0x98, reader.handle)
                if (owner, parent, context) != (SENNA_OWNER, 0, 0):
                    raise ValueError(f"Unexpected Senna W creation context at packet {sequence}")
                descriptor = reader.placement(group, entry, handle, owner, key)
                if descriptor["flags"] != 32:
                    raise ValueError(f"Unexpected Senna W placement flags at packet {sequence}")
                events.append({
                    "stamp": stamp,
                    "sequence": sequence,
                    "handle": handle,
                    "packetSha256": sha256(payload).hexdigest(),
                })
    if len(events) != 46 or len({event["handle"] for event in events}) != len(events):
        raise ValueError("Original Rift Senna W creation census differs")

    # The equipped Senna skin 18 uses the Skin16 effect for this resource.
    # Its authored ground-hit Wwise event has a single original media child.
    receipt = {
        "schema": 1,
        "build": corpus["build"],
        "protocol": corpus["protocol"],
        "replaySha256": corpus["replaySha256"],
        "corpusSha256": CORPUS_SHA256,
        "executableSha256": archive_digest,
        "resourceKey": RESOURCE_KEY,
        "mediaId": MEDIA_ID,
        "events": events,
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(receipt, out, indent=2)
        out.write("\n")
    print(sha256(args.output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
