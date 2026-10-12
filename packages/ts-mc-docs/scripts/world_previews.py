"""Read spawn metadata and extract bounded, unconverted terrain for previews."""

from __future__ import annotations

import io
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path


class NbtReader:
    def __init__(self, data: bytes):
        self.stream = io.BytesIO(data)

    def read(self, count: int) -> bytes:
        if count < 0:
            raise ValueError("Negative NBT length")
        data = self.stream.read(count)
        if len(data) != count:
            raise ValueError("Truncated NBT metadata")
        return data

    def integer(self, size: int = 4) -> int:
        return int.from_bytes(self.read(size), "big", signed=True)

    def string(self) -> str:
        return self.read(int.from_bytes(self.read(2), "big")).decode("utf-8")

    def skip(self, kind: int) -> None:
        sizes = {1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8}
        if kind in sizes:
            self.read(sizes[kind])
        elif kind in (7, 11, 12):
            self.read(self.integer() * {7: 1, 11: 4, 12: 8}[kind])
        elif kind == 8:
            self.read(int.from_bytes(self.read(2), "big"))
        elif kind == 9:
            child = self.read(1)[0]
            count = self.integer()
            if count < 0:
                raise ValueError("Negative NBT list length")
            for _ in range(count):
                self.skip(child)
        elif kind == 10:
            while (child := self.read(1)[0]) != 0:
                self.string()
                self.skip(child)
        else:
            raise ValueError(f"Unsupported NBT tag: {kind}")


def level_metadata(compressed: bytes) -> tuple[bytes, tuple[int, int]]:
    # Some historical exports append junk after the first gzip stream. Keep
    # downloads unchanged; give the preview reader only the valid stream.
    gzip = zlib.decompressobj(wbits=31)
    data = gzip.decompress(compressed, 16 * 1024**2)
    if not gzip.eof:
        raise ValueError("Truncated or oversized level.dat")
    reader = NbtReader(data)
    if reader.read(1) != b"\x0a":
        raise ValueError("level.dat must be an NBT compound")
    reader.string()
    spawn: dict[str, int] = {}
    while (kind := reader.read(1)[0]) != 0:
        name = reader.string()
        if name != "Data" or kind != 10:
            reader.skip(kind)
            continue
        while (child := reader.read(1)[0]) != 0:
            name = reader.string()
            if name in ("SpawnX", "SpawnZ") and child == 3:
                spawn[name] = reader.integer()
            else:
                reader.skip(child)
    if set(spawn) != {"SpawnX", "SpawnZ"}:
        raise ValueError("World is missing its spawn coordinates")
    valid_gzip = compressed[: len(compressed) - len(gzip.unused_data)]
    return valid_gzip, (spawn["SpawnX"], spawn["SpawnZ"])


@dataclass(frozen=True)
class PreviewArea:
    kind: str
    x: int
    z: int
    blocks: int
    zoom: int

    @property
    def pixels(self) -> int:
        return self.blocks * 2**self.zoom

    @property
    def argument(self) -> str:
        return f"b({self.x},{self.z},{self.blocks},{self.blocks})"

    def includes(self, path: Path) -> bool:
        if path.parent.as_posix() != "region":
            return False
        parts = path.name.split(".")
        if len(parts) != 4 or parts[0] != "r" or parts[3] != "mca":
            return False
        x, z = int(parts[1]), int(parts[2])
        # One chunk of neighboring terrain supports edge shading.
        return (self.x - 16) // 512 <= x <= (self.x + self.blocks + 15) // 512 and (self.z - 16) // 512 <= z <= (
            self.z + self.blocks + 15
        ) // 512


def preview_areas(spawn: tuple[int, int]) -> list[PreviewArea]:
    x, z = spawn
    return [PreviewArea("overview", x - 1024, z - 1024, 2048, 0), PreviewArea("closeup", x - 256, z - 256, 512, 1)]


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG: {path}")
    return struct.unpack(">II", header[16:24])
