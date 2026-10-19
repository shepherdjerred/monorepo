"""Anvil region headers and offline pruning of saved chunks beyond a circular world border."""

import fcntl
import hashlib
import json
import math
import os
import re
import sqlite3
import struct
import uuid
from collections.abc import Generator, Iterable, Iterator
from contextlib import ExitStack, closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import restoration_files as storage

STORES = ("region", "entities", "poi")
REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca")
HEADER = 8192


def region_chunks(name: str, source: BinaryIO, size: int) -> dict[str, int]:
    """Validate one Anvil region's allocation headers without loading or regenerating a single chunk."""
    parts = name.split(".")
    if len(parts) != 4 or parts[0] != "r" or parts[3] != "mca":
        raise ValueError("Malformed region filename")
    rx, rz = int(parts[1]), int(parts[2])
    result = {}
    header = source.read(HEADER)
    if len(header) != HEADER:
        raise ValueError(f"Truncated region: {name}")
    occupied = set()
    for index in range(1024):
        location = struct.unpack_from(">I", header, index * 4)[0]
        if location == 0:
            continue
        sector, count = location >> 8, location & 255
        if sector < 2 or count == 0 or (sector + count) * 4096 > size:
            raise ValueError(f"Invalid chunk allocation: {name}:{index}")
        allocation = set(range(sector, sector + count))
        if occupied.intersection(allocation):
            raise ValueError(f"Overlapping chunk allocation: {name}:{index}")
        occupied.update(allocation)
        source.seek(sector * 4096)
        length = struct.unpack(">I", source.read(4))[0]
        compression = source.read(1)
        if length < 1 or length + 4 > count * 4096 or compression not in (b"\x01", b"\x02", b"\x03"):
            raise ValueError(f"Unsupported or truncated chunk: {name}:{index}")
        result[f"{rx * 32 + index % 32},{rz * 32 + index // 32}"] = length
    return result


def chunk_ring(value: int) -> int:
    """Chunk distance index from the block corner 0,0: chunks -1 and 0 are both ring 0."""
    return value if value >= 0 else -value - 1


def chunk_nearest(x: int, z: int) -> float:
    """Distance from the block corner 0,0 to the nearest point of chunk x,z."""
    return math.hypot(16 * chunk_ring(x), 16 * chunk_ring(z))


def chunk_key(key: str) -> tuple[int, int]:
    x, z = key.split(",")
    return int(x), int(z)


def outside(x: int, z: int, radius: int) -> bool:
    """A chunk is removed only when it lies entirely outside the open disc."""
    return chunk_nearest(x, z) >= radius


def area_chunks(low_x: int, low_z: int, high_x: int, high_z: int) -> Iterator[tuple[int, int]]:
    for x in range(low_x >> 4, (high_x >> 4) + 1):
        for z in range(low_z >> 4, (high_z >> 4) + 1):
            yield x, z


def heritage_chunks(catalog: Path, world: str) -> dict[str, set[tuple[int, int]]]:
    """Read the catalog's protected footprints; it is JSON in YAML flow syntax with trailing commas."""
    document = json.loads(re.sub(r",(\s*[\]}])", r"\1", catalog.read_text(encoding="utf-8")))
    result = {}
    for site in document["sites"]:
        if site["world"] != world:
            continue
        chunks = {(chunk["x"], chunk["z"]) for chunk in site["protectedChunks"]}
        for area in site["protectedAreas"]:
            chunks.update(area_chunks(area["from"]["x"], area["from"]["z"], area["to"]["x"], area["to"]["z"]))
        result[site["id"]] = chunks
    return result


def active_towns(catalog: Path, world: str) -> list[tuple[str, str, str]]:
    """The world's PLAYER sites as (stable town id, active town name, mayor), as the towns domain derives them."""
    document = json.loads(re.sub(r",(\s*[\]}])", r"\1", catalog.read_text(encoding="utf-8")))
    result = []
    for site in document["sites"]:
        if site["world"] == world and site["kind"] == "PLAYER":
            identity = uuid.UUID(bytes=_name_uuid("the-storm:heritage-town:v1:" + site["id"]))
            result.append((str(identity), site["activeTownName"], site["editors"][0]["player"]))
    return result


def _name_uuid(name: str) -> bytes:
    """Java's UUID.nameUUIDFromBytes: an MD5 name-based (version 3) UUID without a namespace."""
    digest = bytearray(hashlib.md5(name.encode("utf-8")).digest())
    digest[6] = (digest[6] & 0x0F) | 0x30
    digest[8] = (digest[8] & 0x3F) | 0x80
    return bytes(digest)


PARCEL = re.compile(
    r"^  - id: (?P<id>\S+)\n(?:    .*\n)*?    area:\n      world: (?P<world>\S+)\n"
    r"      from: \{ x: (?P<x1>-?\d+), y: -?\d+, z: (?P<z1>-?\d+) \}\n"
    r"      to: \{ x: (?P<x2>-?\d+), y: -?\d+, z: (?P<z2>-?\d+) \}\n",
    re.MULTILINE,
)


def parcel_chunks(parcels: Path, world: str) -> dict[str, set[tuple[int, int]]]:
    text = parcels.read_text(encoding="utf-8")
    matches = list(PARCEL.finditer(text))
    if len(matches) != len(re.findall(r"^  - id: ", text, re.MULTILINE)) or not matches:
        raise ValueError("Parcel catalog has an entry outside the reviewed area layout")
    return {
        match["id"]: set(area_chunks(int(match["x1"]), int(match["z1"]), int(match["x2"]), int(match["z2"])))
        for match in matches
        if match["world"] == world
    }


def read_only(database: Path) -> sqlite3.Connection:
    if database.is_symlink() or not database.is_file():
        raise ValueError("Server database must be a regular file: " + database.name)
    return sqlite3.connect(database.resolve(strict=True).as_uri() + "?mode=ro&immutable=1", uri=True)


def server_report(data: Path, world: str, radius: int) -> dict[str, object]:
    """Town claims and player-placed CoreProtect blocks entirely outside the disc, from stopped databases."""
    claims: dict[str, list[list[int]]] = {}
    with closing(read_only(data / "plugins/TheStorm/the-storm.db")) as connection:
        for town, x, z in connection.execute(
            "SELECT t.name, c.chunk_x, c.chunk_z FROM towns_claim c JOIN towns_town t ON t.id = c.town_id"
            " WHERE c.world = ? ORDER BY t.name, c.chunk_x, c.chunk_z",
            (world,),
        ):
            if outside(x, z, radius):
                claims.setdefault(town, []).append([x, z])
    placed: dict[str, int] = {}
    with closing(read_only(data / "plugins/CoreProtect/database.db")) as connection:
        for user, x, z in connection.execute(
            "SELECT u.user, b.x, b.z FROM co_block b JOIN co_user u ON u.id = b.user"
            " JOIN co_world w ON w.id = b.wid WHERE w.world = ? AND b.action = 1 AND u.user NOT LIKE '#%'",
            (world,),
        ):
            if outside(x >> 4, z >> 4, radius):
                placed[user] = placed.get(user, 0) + 1
    return {"townClaims": claims, "placedBlocksByPlayer": dict(sorted(placed.items()))}


@dataclass(frozen=True)
class RegionPlan:
    sha256: str
    chunks: int
    removed: tuple[str, ...]
    delete_file: bool

    def facts(self) -> dict[str, object]:
        return {
            "sha256": self.sha256,
            "chunks": self.chunks,
            "removedChunks": list(self.removed),
            "deleteFile": self.delete_file,
        }


@dataclass(frozen=True)
class StorePlan:
    regions: dict[str, RegionPlan]

    @property
    def before(self) -> int:
        return sum(region.chunks for region in self.regions.values())

    @property
    def removed(self) -> int:
        return sum(len(region.removed) for region in self.regions.values())

    def facts(self) -> dict[str, object]:
        return {
            "chunksBefore": self.before,
            "chunksRemoved": self.removed,
            "regions": {name: region.facts() for name, region in self.regions.items()},
        }


def store_plan(directory: Path, radius: int) -> StorePlan:
    """Inventory one store and decide which chunks and whole region files lie beyond the disc."""
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Dimension store must be a regular directory: " + directory.name)
    regions = {}
    for path in sorted(directory.iterdir()):
        match = REGION.fullmatch(path.name)
        if path.is_symlink() or not path.is_file() or match is None:
            raise ValueError("Unexpected entry in dimension store: " + path.name)
        rx, rz = int(match[1]), int(match[2])
        with path.open("rb") as source:
            chunks = region_chunks(path.name, source, path.stat().st_size)
        # A region is deleted only when even its chunk nearest the origin is outside.
        whole = outside(rx * 32 + (0 if rx >= 0 else 31), rz * 32 + (0 if rz >= 0 else 31), radius)
        removed = tuple(sorted(key for key in chunks if outside(*chunk_key(key), radius)))
        regions[path.name] = RegionPlan(storage.digest(path), len(chunks), removed, whole)
    return StorePlan(regions)


def header_digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.sha256(source.read(HEADER)).hexdigest()


def clear_chunks(path: Path, removed: Iterable[str], expected_sha256: str) -> None:
    """Atomically replace a region with zeroed location and timestamp entries; chunk sectors are untouched."""
    original = path.read_bytes()
    if hashlib.sha256(original).hexdigest() != expected_sha256:
        raise ValueError("Region changed after planning: " + path.name)
    updated = bytearray(original)
    match = REGION.fullmatch(path.name)
    if match is None:
        raise ValueError("Malformed region filename")
    rx, rz = int(match[1]), int(match[2])
    for key in removed:
        x, z = chunk_key(key)
        index = (x - rx * 32) + (z - rz * 32) * 32
        struct.pack_into(">I", updated, index * 4, 0)
        struct.pack_into(">I", updated, 4096 + index * 4, 0)
    temporary = path.with_name(f".{path.name}.prune-{uuid.uuid4()}.tmp")
    owner = path.stat()
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(updated)
            stream.flush()
            os.fchmod(stream.fileno(), owner.st_mode & 0o777)
            os.fchown(stream.fileno(), owner.st_uid, owner.st_gid)
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    storage.sync_directory(path.parent)


@contextmanager
def stopped_dimension(dimension: Path, data: Path | None) -> Generator[None]:
    """Hold the server's world locks, or any save lock inside a standalone export, for the whole prune."""
    with ExitStack() as stack:
        if data is not None:
            stack.enter_context(storage.stopped(data))
        for lock in sorted(dimension.rglob("session.lock")):
            if lock.is_symlink():
                raise ValueError("Dimension save lock is a symlink")
            handle = stack.enter_context(lock.open("r+b"))
            try:
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as failure:
                raise ValueError("Paper still holds a dimension save lock") from failure
        yield


def prune_dimension(
    dimension: Path,
    world: str,
    radius: int,
    receipt: Path,
    *,
    data: Path | None,
    apply: bool,
    allow_outside_claims: bool,
    owned: Path,
) -> dict[str, object]:
    """Remove saved chunks entirely outside an origin-centred disc from a stopped native dimension."""
    if radius < 16:
        raise ValueError("Pruning radius must keep at least the origin chunks")
    # The dimension, its dimensions/minecraft/<name> layout and its world directory must be real.
    for path in (dimension, receipt, *list(dimension.parents)[:3], *(() if data is None else (data,))):
        if path.is_symlink():
            raise ValueError("Pruning inputs cannot be linked")
    dimension = dimension.resolve(strict=True)
    if dimension.parent.name != "minecraft" or dimension.parent.parent.name != "dimensions":
        raise ValueError("Pruning requires a native dimensions/minecraft/<name> directory")
    if data is not None:
        data = data.resolve(strict=True)
        if not dimension.is_relative_to(data / "world/dimensions/minecraft"):
            raise ValueError("The dimension must belong to the stopped server data root")
    if receipt.exists() or receipt.resolve().is_relative_to(dimension):
        raise ValueError("Pruning receipt must be new and outside the dimension")
    catalog = owned / "owned/plugins/TheStorm/heritage.yml"
    parcels = owned / "owned/plugins/TheStorm/parcels.yml"
    with stopped_dimension(dimension, data):
        protected = {
            "heritage": {
                site: sorted([x, z] for x, z in chunks if outside(x, z, radius))
                for site, chunks in heritage_chunks(catalog, world).items()
            },
            "parcels": {
                parcel: sorted([x, z] for x, z in chunks if outside(x, z, radius))
                for parcel, chunks in parcel_chunks(parcels, world).items()
            },
        }
        protected = {kind: {name: value for name, value in sites.items() if value} for kind, sites in protected.items()}
        report: dict[str, object] = {
            "heritageChunksOutside": protected["heritage"],
            "parcelChunksOutside": protected["parcels"],
            "server": "NOT_PROVIDED" if data is None else server_report(data, world, radius),
        }
        server = report["server"]
        claims_outside = bool(protected["heritage"] or protected["parcels"]) or (
            isinstance(server, dict) and bool(server["townClaims"])
        )
        plans = {store: store_plan(dimension / store, radius) for store in STORES if (dimension / store).exists()}
        if "region" not in plans:
            raise ValueError("Dimension has no saved terrain")
        facts: dict[str, object] = {
            "schemaVersion": 1,
            "dimension": str(dimension),
            "world": world,
            "radius": radius,
            "rule": "remove chunks whose nearest point is at least radius blocks from block corner 0,0",
            "mode": "APPLY" if apply else "DRY_RUN",
            "inputs": {"heritage.yml": storage.digest(catalog), "parcels.yml": storage.digest(parcels)},
            "safety": report,
            "plan": {store: plan.facts() for store, plan in plans.items()},
        }
        if not apply:
            facts["status"] = "PLANNED"
            storage.save(receipt, facts)
            return facts
        if claims_outside and not allow_outside_claims:
            raise ValueError("Claims, parcels or heritage chunks lie entirely outside the disc; review the dry run")
        facts["status"] = "APPLYING"
        storage.save(receipt, facts)
        for store, plan in plans.items():
            for name, region in plan.regions.items():
                path = dimension / store / name
                if region.delete_file:
                    if storage.digest(path) != region.sha256:
                        raise ValueError("Region changed after planning: " + name)
                    path.unlink()
                    storage.sync_directory(path.parent)
                elif region.removed:
                    clear_chunks(path, region.removed, region.sha256)
        result = {}
        for store, plan in plans.items():
            directory = dimension / store
            after = store_plan(directory, radius)
            if after.removed != 0 or after.before != plan.before - plan.removed:
                raise ValueError("Pruned store still has chunks outside the disc: " + store)
            for name, region in plan.regions.items():
                path = directory / name
                if region.delete_file == path.exists():
                    raise ValueError("Pruned region file disposition differs from the plan: " + name)
                if path.exists() and not region.removed and storage.digest(path) != region.sha256:
                    raise ValueError("Pruning changed a region with no removed chunks: " + name)
            result[store] = {
                "chunksBefore": plan.before,
                "chunksAfter": after.before,
                "chunksRemoved": plan.removed,
                "removedRegionFiles": sorted(name for name, region in plan.regions.items() if region.delete_file),
                "headerSha256": {path.name: header_digest(path) for path in sorted(directory.iterdir())},
            }
        facts.update(status="VERIFIED", result=result)
        storage.save(receipt, facts)
        return facts
