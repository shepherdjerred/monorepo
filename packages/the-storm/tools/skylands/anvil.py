"""Strict saved-Anvil reader for extended native acceptance, including 26.3 palettes."""

import gzip
import io
import zlib
from pathlib import Path

import nbtlib
import numpy as np


class Anvil:
    def __init__(self, dimension, defaults=None):
        self.dimension = Path(dimension)
        self.defaults = defaults if defaults is not None else {}
        self.regions = {}
        self.chunks = {}
        self.sections = {}
        self.states = [("minecraft:air", {})]
        self.state_ids = {("minecraft:air", ()): 0}

    @staticmethod
    def records(path):
        data = Path(path).read_bytes()
        for i in range(1024):
            offset = (int.from_bytes(data[i * 4 : i * 4 + 4], "big") >> 8) * 4096
            if not offset:
                continue
            length = int.from_bytes(data[offset : offset + 4], "big")
            compression = data[offset + 4]
            payload = data[offset + 5 : offset + 4 + length]
            decompress = {1: gzip.decompress, 2: zlib.decompress, 3: lambda b: b}[compression]
            yield i, nbtlib.File.parse(io.BytesIO(decompress(payload)))

    def chunk(self, x, z):
        key = (x, z)
        if key not in self.chunks:
            region = (x // 32, z // 32)
            if region not in self.regions:
                path = self.dimension / "region" / f"r.{region[0]}.{region[1]}.mca"
                self.regions[region] = dict(self.records(path))
            index = (z % 32) * 32 + x % 32
            if index not in self.regions[region]:
                raise AssertionError(f"Chunk {key} was not generated")
            self.chunks[key] = self.regions[region][index]
        return self.chunks[key]

    def section(self, cx, sy, cz):
        key = cx, sy, cz
        if key in self.sections:
            return self.sections[key]
        source = next((s for s in self.chunk(cx, cz)["sections"] if int(s["Y"]) == sy), None)
        # Absent sections are all-air in the Anvil format.
        if source is None:
            result = np.zeros((16, 16, 16), dtype=np.uint16)
        else:
            palette = source["block_states"]["palette"]
            identifiers = []
            for item in palette:
                if isinstance(item, str):
                    name, props = str(item), {}
                else:
                    name = str(item.get("id", item.get("", "")))
                    props = {str(k): str(v) for k, v in item.get("properties", {}).items()}
                assert name.startswith("minecraft:"), item
                state = name, tuple(sorted(props.items()))
                if state not in self.state_ids:
                    self.state_ids[state] = len(self.states)
                    self.states.append((name, props))
                identifiers.append(self.state_ids[state])
            if len(palette) == 1:
                result = np.full((16, 16, 16), identifiers[0], dtype=np.uint16)
            else:
                bits = max(4, (len(palette) - 1).bit_length())
                per = 64 // bits
                indices = np.arange(4096, dtype=np.uint64)
                words = np.asarray(source["block_states"]["data"], dtype=np.int64).view(np.uint64)
                decoded = (words[indices // per] >> ((indices % per) * bits)) & ((1 << bits) - 1)
                result = np.asarray(identifiers, dtype=np.uint16)[decoded].reshape((16, 16, 16))
        self.sections[key] = result
        return result

    def block(self, p):
        x, y, z = p
        identifier = self.section(x // 16, y // 16, z // 16)[y % 16, z % 16, x % 16]
        name, props = self.states[int(identifier)]
        return name, {**self.defaults.get(name, {}), **props}

    def light(self, p):
        x, y, z = p
        section = next(s for s in self.chunk(x // 16, z // 16)["sections"] if int(s["Y"]) == y // 16)
        values = section.get("BlockLight")
        if values is None:
            return 0  # Missing block-light array denotes zero block light.
        i = (y % 16) * 256 + (z % 16) * 16 + x % 16
        return ((int(values[i // 2]) & 255) >> ((i % 2) * 4)) & 15

    def entities(self):
        for path in sorted((self.dimension / "entities").glob("*.mca")):
            for _, chunk in self.records(path):
                yield from chunk["Entities"]
