"""Diagnostic comparison against the pinned historical RoflLens framing reader.

Requires the README's pinned RoflLens research environment. The temporary copy
removes the verified extra chunk byte for the legacy reader. It is never a
playback fixture and its signature is not validated by this comparison.
The pinned reader uses unsigned context deltas and float64 time accumulation;
it disagrees with this exact game's signed-i8/float32 native reader. Use
sample-native-framing.mjs and verify-native-framing.py for current validation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import tempfile

from rofllens.container import ReplayReader


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replay", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    source = args.replay.read_bytes()
    expected = json.loads(args.report.read_text(encoding="utf-8"))["replay"]
    if hashlib.sha256(source).hexdigest() != expected["sha256"]:
        raise ValueError("Inspection report does not match this replay")
    if (expected["build"], expected["protocol"]) != (
        "16.21.829.8620", "20e09df23c66b85e"
    ):
        raise ValueError("Normalization is established only for this exact build/protocol")
    cursor = 15 + source[14]
    end = len(source) - 4 - struct.unpack_from("<I", source, len(source) - 4)[0] - 256
    parts = [source[:cursor]]
    while cursor < end:
        if cursor + 18 > end:
            raise ValueError("Truncated chunk header")
        _, _, _, raw, compressed, tag = struct.unpack_from("<IBIIIB", source, cursor)
        size = compressed or raw
        if tag != 4 or cursor + 18 + size > end:
            raise ValueError("Unexpected chunk tag or bounds")
        parts.extend([source[cursor:cursor + 17], source[cursor + 18:cursor + 18 + size]])
        cursor += 18 + size
    if cursor != end:
        raise ValueError("Chunk boundary mismatch")
    parts.append(source[end:])
    digest = hashlib.sha256()
    count = 0
    with tempfile.TemporaryDirectory(prefix="scout-transport-check-") as scratch:
        normalized = Path(scratch) / "normalized-NOT-PLAYBACK.rofl"
        normalized.write_bytes(b"".join(parts))
        with ReplayReader.open(normalized) as replay:
            for block in replay.iter_blocks(streams={1, 2}, include_payload=True):
                digest.update(struct.pack(
                    "<BdHII", block.stream_id, block.timestamp, block.packet_id,
                    block.param, len(block.payload)
                ))
                digest.update(block.payload)
                count += 1
    if count != expected["blocks"] or digest.hexdigest() != expected["packetDigest"]:
        raise ValueError("Pinned RoflLens transport disagrees with current native-backed signed-i8/float32 framing; use verify-native-framing.py")
    print(json.dumps({"blocks": count, "packetDigest": digest.hexdigest(),
                      "comparison": "RoflLens with explicit chunk-header normalization; transport only"}))


if __name__ == "__main__":
    main()
