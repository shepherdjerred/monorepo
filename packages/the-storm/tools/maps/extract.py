"""Inspect a legacy map ZIP and extract a private copy; never modify the source."""

import argparse
import hashlib
import json
import re
import shutil
import stat
import struct
import zipfile
from pathlib import Path

ALLOWED_FILE = re.compile(r"(?:config\.yml|level\.dat|region/r\.-?\d+\.-?\d+\.mca)")
MAX_BYTES = 128 * 1024 * 1024


def saved_chunks(zipped: zipfile.ZipFile, names: set[str]) -> list[dict[str, int]]:
    chunks: list[dict[str, int]] = []
    for name in sorted(names):
        if not name.startswith("region/"):
            continue
        entry = zipped.getinfo(name)
        if entry.file_size < 8192 or entry.file_size % 4096:
            raise ValueError(f"Invalid Anvil region size: {name}")
        with zipped.open(name) as reader:
            header = reader.read(4096)
        _, region_x, region_z, _ = Path(name).name.split(".")
        for index in range(1024):
            location = struct.unpack_from(">I", header, index * 4)[0]
            if location == 0:
                continue
            sector, count = location >> 8, location & 255
            if sector < 2 or count == 0 or (sector + count) * 4096 > entry.file_size:
                raise ValueError(f"Invalid saved chunk allocation: {name} index {index}")
            chunks.append({"x": int(region_x) * 32 + index % 32, "z": int(region_z) * 32 + index // 32})
    return chunks


def extract(archive: Path, output: Path) -> dict[str, object]:
    source = archive.read_bytes()
    digest = hashlib.sha256(source).hexdigest()
    with zipfile.ZipFile(archive) as zipped:
        names: set[str] = set()
        size = 0
        for entry in zipped.infolist():
            if entry.is_dir():
                if entry.filename != "region/":
                    raise ValueError(f"Unexpected directory: {entry.filename}")
                continue
            if not ALLOWED_FILE.fullmatch(entry.filename):
                raise ValueError(f"Unexpected map entry: {entry.filename}")
            if entry.filename in names:
                raise ValueError(f"Duplicate map entry: {entry.filename}")
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f"Symlink map entry: {entry.filename}")
            names.add(entry.filename)
            size += entry.file_size
            if size > MAX_BYTES:
                raise ValueError("Map archive exceeds the 128 MiB extraction limit")
        if not {"config.yml", "level.dat"}.issubset(names) or not any(name.startswith("region/") for name in names):
            raise ValueError("Map requires config.yml, level.dat and saved region files")
        chunks = saved_chunks(zipped, names)
        if not chunks:
            raise ValueError("Map archive has no saved chunks")
        output.mkdir(parents=False, exist_ok=False, mode=0o700)
        (output / "source.zip").write_bytes(source)
        world = output / "world"
        (world / "region").mkdir(parents=True)
        for name in sorted(names):
            destination = output / name if name == "config.yml" else world / name
            with zipped.open(name) as reader, destination.open("xb") as writer:
                shutil.copyfileobj(reader, writer)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise ValueError("Source map changed during extraction")
    return {"sha256": digest, "files": sorted(names), "expandedBytes": size, "savedChunks": chunks}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.archive, args.output)))
