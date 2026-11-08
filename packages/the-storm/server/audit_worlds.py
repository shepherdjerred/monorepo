"""Read-only Anvil block-entity census; run against a backup or read-only live files.

Example: python3 audit_worlds.py --world world=/data/world/dimensions/minecraft/overworld/region
The JSONL contains every sign and inventory, including original item components.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import struct
import sys
import zlib
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

MAX_PAYLOAD = 64 << 20
REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca")


class NbtReader:
    def __init__(self, stream: BinaryIO):
        self.stream = stream

    def take(self, size: int) -> bytes:
        if size < 0 or size > MAX_PAYLOAD:
            raise ValueError(f"invalid NBT payload size {size}")
        value = self.stream.read(size)
        if len(value) != size:
            raise ValueError("truncated NBT payload")
        return value

    def number(self, shape: str) -> int | float:
        return struct.unpack(">" + shape, self.take(struct.calcsize(shape)))[0]

    def integer(self, shape: str) -> int:
        value = self.number(shape)
        if not isinstance(value, int):
            raise ValueError("NBT integer expected")
        return value

    def text(self) -> str:
        raw = self.take(self.integer("H"))
        return raw.replace(b"\xc0\x80", b"\0").decode("utf-8", errors="surrogatepass")

    def skip(self, kind: int, depth: int) -> None:
        if depth > 128:
            raise ValueError("NBT nesting exceeds 128 levels")
        if 1 <= kind <= 6:
            self.take({1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8}[kind])
        elif kind == 8:
            self.take(self.integer("H"))
        elif kind == 10:
            while (child := self.integer("B")) != 0:
                self.take(self.integer("H"))
                self.skip(child, depth + 1)
        elif kind in (7, 9, 11, 12):
            child = self.integer("B") if kind == 9 else 0
            count = self.integer("i")
            if count < 0 or count > MAX_PAYLOAD:
                raise ValueError("invalid skipped NBT length")
            if kind == 9:
                for _ in range(count):
                    self.skip(child, depth + 1)
            else:
                self.take(count * {7: 1, 11: 4, 12: 8}[kind])
        else:
            raise ValueError(f"unsupported skipped NBT tag {kind}")

    def payload(self, kind: int, depth: int = 0, chunk: bool = False) -> object:
        if depth > 128:
            raise ValueError("NBT nesting exceeds 128 levels")
        if 1 <= kind <= 6:
            return self.number({1: "b", 2: "h", 3: "i", 4: "q", 5: "f", 6: "d"}[kind])
        if kind == 8:
            return self.text()
        if kind == 10:
            result: dict[str, object] = {}
            while (child := self.integer("B")) != 0:
                name = self.text()
                if name in result:
                    raise ValueError(f"duplicate NBT key {name}")
                if chunk and name not in {"Level", "TileEntities", "block_entities", "xPos", "zPos"}:
                    self.skip(child, depth + 1)
                else:
                    result[name] = self.payload(child, depth + 1, chunk and name == "Level")
            return result
        if kind in (7, 9, 11, 12):
            child = self.integer("B") if kind == 9 else {7: 1, 11: 3, 12: 4}[kind]
            size = self.integer("i")
            if size < 0 or size > MAX_PAYLOAD:
                raise ValueError(f"invalid NBT array length {size}")
            if size and child == 0:
                raise ValueError("nonempty NBT list has END elements")
            return [self.payload(child, depth + 1) for _ in range(size)]
        raise ValueError(f"unsupported NBT tag {kind}")

    def root(self, chunk: bool = False) -> dict[str, object]:
        if self.integer("B") != 10:
            raise ValueError("NBT root must be a compound")
        self.text()
        value = self.payload(10, chunk=chunk)
        if not isinstance(value, dict):
            raise ValueError("NBT root is not a compound")
        return value


def chunks(path: Path) -> Iterator[dict[str, object]]:
    matched = REGION.fullmatch(path.name)
    if matched is None:
        raise ValueError(f"not an Anvil region: {path}")
    region_x, region_z = map(int, matched.groups())
    with path.open("rb") as region:
        header = region.read(8192)
        if len(header) != 8192:
            raise ValueError(f"truncated region header: {path}")
        for index in range(1024):
            location = struct.unpack_from(">I", header, index * 4)[0]
            if location == 0:
                continue
            offset, sectors = location >> 8, location & 255
            if offset < 2 or sectors == 0:
                raise ValueError(f"invalid region allocation: {path}, chunk {index}")
            region.seek(offset * 4096)
            prefix = region.read(5)
            if len(prefix) != 5:
                raise ValueError(f"truncated chunk header: {path}, chunk {index}")
            length, compression = struct.unpack(">IB", prefix)
            if not 1 <= length <= min(MAX_PAYLOAD, sectors * 4096 - 4):
                raise ValueError(f"invalid chunk length: {path}, chunk {index}")
            if compression & 128:
                x, z = region_x * 32 + index % 32, region_z * 32 + index // 32
                payload = (path.parent / f"c.{x}.{z}.mcc").read_bytes()
            else:
                payload = region.read(length - 1)
                if len(payload) != length - 1:
                    raise ValueError(f"truncated chunk: {path}, chunk {index}")
            compression &= 127
            if compression == 1:
                payload = gzip.decompress(payload)
            elif compression == 2:
                payload = zlib.decompress(payload)
            elif compression != 3:
                raise ValueError(f"unsupported Anvil compression {compression}: {path}")
            if len(payload) > MAX_PAYLOAD:
                raise ValueError(f"oversized chunk: {path}, chunk {index}")
            yield NbtReader(io.BytesIO(payload)).root(chunk=True)


def entities(chunk: dict[str, object]) -> Iterator[dict[str, object]]:
    level = chunk.get("Level", chunk)
    if not isinstance(level, dict):
        raise ValueError("chunk Level must be a compound")
    saved = level.get("block_entities", level.get("TileEntities", []))
    if not isinstance(saved, list):
        raise ValueError("block entities must be a list")
    for entity in saved:
        if not isinstance(entity, dict):
            raise ValueError("block entity must be a compound")
        if "sign" in str(entity.get("id", "")) or "Items" in entity or "items" in entity:
            yield entity


def survey(world: str, directory: Path) -> Iterator[dict[str, object]]:
    if not directory.is_dir():
        raise ValueError(f"missing region directory: {directory}")
    regions = sorted(directory.glob("r.*.*.mca"))
    if not regions:
        raise ValueError(f"no Anvil region files in {directory}")
    count = 0
    for index, path in enumerate(regions):
        for chunk in chunks(path):
            for entity in entities(chunk):
                yield {"world": world, "region": path.name, "data": entity}
                count += 1
        if (index + 1) % 20 == 0:
            print(f"{world}: {index + 1}/{len(regions)} regions, {count} block entities", file=sys.stderr)
    print(f"{world}: complete, {len(regions)} regions, {count} block entities", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world", action="append", required=True, metavar="NAME=REGION_DIRECTORY")
    args = parser.parse_args()
    for specification in args.world:
        world, separator, directory = specification.partition("=")
        if not separator or not world or not directory:
            parser.error("--world requires NAME=REGION_DIRECTORY")
        for entity in survey(world, Path(directory)):
            print(json.dumps(entity, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()
