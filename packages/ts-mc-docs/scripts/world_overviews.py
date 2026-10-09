#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Render and certify static BlueMap overviews from disposable archive copies."""

from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import json
import mimetypes
import os
import re
import shutil
import struct
import subprocess
import time
import urllib.request
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

from overview_types import (
    Asset,
    Checkpoint,
    NamedWorld,
    OverviewPublication,
    TerrainInventory,
    ToolConfig,
    ToolPin,
    VersionedWorld,
)
from world_archive import (
    AWS_ENV,
    BUCKET,
    CHUNK,
    ENDPOINT,
    ORIGIN,
    PACKAGE,
    REPO,
    WorldFiles,
    aws,
    listed_worlds,
    load_catalog,
    require_space,
    retained_path,
    safe_parts,
    sha256,
    stream_sha256,
    verify_checkpoint,
    verify_url,
    write_json,
)
from world_archive import (
    Publication as ArchivePublication,
)
from world_archive import (
    document as document_archive,
)
from world_previews import NbtReader, level_metadata

TOOLS_PATH = PACKAGE / "archive/overview-tools.json"
PUBLICATION_PATH = PACKAGE / "archive/overviews.json"
REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca")
UPLOAD_WORKERS = 8
CONVERSION_COMPLETE = "STORM_ARCHIVE_CONVERSION_COMPLETE"


def tool_config() -> ToolConfig:
    config: ToolConfig = json.loads(TOOLS_PATH.read_text(encoding="utf-8"))
    versions = json.loads((REPO / "packages/version-catalog/src/catalog.json").read_text())
    pins = {entry["name"]: entry["value"] for entry in versions["entries"]}
    for key, entry in (("bluemap", "bluemap/archive-cli"), ("upgrader", "minecraft/archive-upgrader")):
        if config[key]["version"] != pins[entry]:
            raise ValueError(f"Overview {key} disagrees with the version catalogue")
    if config["webapp"]["version"] != config["bluemap"]["version"]:
        raise ValueError("Viewer source must match the BlueMap renderer")
    if not re.fullmatch(r"[a-z0-9.-]+", config["release"]):
        raise ValueError("Invalid overview release")
    config["javaImage"] = f"itzg/minecraft-server:{pins['itzg/minecraft-server-java17-archive']}"
    config["upgraderPatchSha256"] = sha256(PACKAGE / "scripts/PatchUpgrader.java")
    config["rendererPatchSha256"] = sha256(PACKAGE / "scripts/PatchRenderer.java")
    return config


def fetch_tool(scratch: Path, name: str, pin: ToolPin) -> Path:
    tools = scratch / "tools"
    tools.mkdir(exist_ok=True)
    suffix = ".zip" if name == "webapp" else ".jar"
    target = tools / f"{name}-{pin['version']}{suffix}"
    if not target.exists():
        temporary = target.with_suffix(".partial")
        with urllib.request.urlopen(pin["url"], timeout=120) as src, temporary.open("wb") as dst:
            shutil.copyfileobj(src, dst, CHUNK)
        temporary.replace(target)
    if "sha256" in pin:
        algorithm, expected = "sha256", pin["sha256"]
    elif "sha1" in pin:
        algorithm, expected = "sha1", pin["sha1"]
    else:
        raise ValueError(f"{name} artifact is missing its checksum pin")
    with target.open("rb") as stream:
        actual = hashlib.file_digest(stream, algorithm).hexdigest()
    if actual != expected:
        raise ValueError(f"{name} artifact checksum mismatch")
    if name == "upgrader":
        with zipfile.ZipFile(target) as artifact:
            version = json.loads(artifact.read("version.json"))
        upgrader = tool_config()["upgrader"]
        if version["id"] != upgrader["version"] or version["world_version"] != upgrader["dataVersion"]:
            raise ValueError("Upgrader artifact disagrees with its format certificate")
    return target


def build_viewer(scratch: Path, source: Path) -> Path:
    """Build pinned upstream sources using CSP-compatible i18n compilation."""
    root = scratch / "tools/viewer"
    if not root.exists():
        root.mkdir()
        with zipfile.ZipFile(source) as archive:
            for item in archive.infolist():
                parts = safe_parts(item.filename)
                if len(parts) < 4 or parts[1:3] != ("common", "webapp") or item.is_dir():
                    continue
                path = root.joinpath(*parts[3:])
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read(item))
        config = root / "vite.config.js"
        text = config.read_text()
        if text.count("define: {") != 1:
            raise ValueError("Pinned viewer build configuration changed")
        config.write_text(text.replace("define: {", "define: {\n        __INTLIFY_JIT_COMPILATION__: true,"))
    # This external upstream build imports its pinned package-lock.json. It
    # does not add dependencies or a lockfile to this monorepo's workspace.
    subprocess.run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], cwd=root, check=True)
    subprocess.run(["bun", "run", "build"], cwd=root, check=True, capture_output=True)
    if not (root / "dist/index.html").is_file():
        raise ValueError("Viewer build produced no index")
    return root / "dist"


def install_viewer(viewer: Path, root: Path) -> None:
    # Replace only generated frontend assets; keep map data and settings.
    shutil.rmtree(root / "assets")
    for path in viewer.rglob("*"):
        if path.is_file():
            target = root / path.relative_to(viewer)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)


def native_version(world: VersionedWorld) -> str | None:
    match = re.search(r"1\.(\d+)(?:\.(\d+))?", world["minecraft"])
    # The 1.14.4 archive was only partially upgraded: distant chunks retain
    # pre-palette data. Force-upgrade that disposable copy as well.
    if match is None or (int(match[1]), int(match[2] or 0)) < (17, 1):
        return None
    return match[0]


def locations(header: bytes | bytearray) -> dict[int, tuple[int, int]]:
    if len(header) != 8192:
        raise ValueError("Truncated terrain region header")
    result = {}
    for index, (entry,) in enumerate(struct.iter_unpack(">I", header[:4096])):
        if entry:
            offset, count = entry >> 8, entry & 255
            if offset < 2 or count == 0:
                raise ValueError("Invalid terrain chunk location")
            result[index] = (offset, count)
    return result


def terrain_inventory(world: Path) -> dict[str, list[int]]:
    inventory = {}
    for region in sorted((world / "region").glob("*.mca")):
        if REGION.fullmatch(region.name) is None:
            raise ValueError(f"Unknown terrain region filename: {region.name}")
        with region.open("rb") as stream:
            header = stream.read(8192)
        indices = sorted(locations(header))
        if indices:
            inventory[region.name] = indices
    if not any(inventory.values()):
        raise ValueError("World contains no saved terrain chunks")
    return inventory


def world_format(metadata: bytes) -> int:
    reader = NbtReader(gzip.decompress(metadata))
    if reader.read(1) != b"\x0a":
        raise ValueError("World metadata must be an NBT compound")
    reader.string()
    while (kind := reader.read(1)[0]) != 0:
        name = reader.string()
        if name == "Data" and kind == 10:
            while (child := reader.read(1)[0]) != 0:
                name = reader.string()
                if name == "version" and child == 3:
                    return reader.integer()
                reader.skip(child)
        else:
            reader.skip(kind)
    raise ValueError("World metadata has no storage format version")


def extract_world(source: Path, world: WorldFiles, work: Path) -> tuple[TerrainInventory, tuple[int, int]]:
    target = work / "world"
    target.mkdir()
    with zipfile.ZipFile(source / world["file"]) as archive:
        members = [(item, retained_path(item, world["root"])) for item in archive.infolist()]
        paths = [str(path) for _, path in members if path is not None]
        if len(paths) != len(set(paths)):
            raise ValueError("Duplicate archive member")
        metadata, spawn = level_metadata(archive.read(f"{world['root']}/level.dat"))
        selected = [(item, path) for item, path in members if path is not None and path.parent == Path("region")]
        require_space(work, 2 * sum(item.file_size for item, _ in selected))
        (target / "level.dat").write_bytes(metadata)
        for item, relative in selected:
            # Anvil worlds load .mca terrain. Kargeth also retains obsolete
            # McRegion backups from before its Anvil conversion.
            if re.fullmatch(r"r\.-?\d+\.-?\d+\.mcr", relative.name):
                if world_format(metadata) != 19133:
                    raise ValueError("McRegion terrain requires a separate format conversion")
                continue
            if REGION.fullmatch(relative.name) is None:
                raise ValueError(f"Unknown terrain file: {relative}")
            # One historical upgraded archive includes an empty region file.
            # It contains no chunks, and is excluded only from the render copy.
            if item.file_size == 0:
                continue
            path = target / relative
            path.parent.mkdir(exist_ok=True)
            with archive.open(item) as src, path.open("wb") as dst:
                shutil.copyfileobj(src, dst, CHUNK)
        inventory = terrain_inventory(target)
        write_json(work / "inventory.json", inventory)
    return inventory, spawn


def chunk_version(data: bytes) -> int:
    reader = NbtReader(data)
    if reader.read(1) != b"\x0a":
        raise ValueError("Chunk must be an NBT compound")
    reader.string()
    while (kind := reader.read(1)[0]) != 0:
        name = reader.string()
        if name == "DataVersion" and kind == 3:
            return reader.integer()
        reader.skip(kind)
    raise ValueError("Converted chunk has no DataVersion")


def certify_terrain(world: Path, inventory: TerrainInventory, *, converted: bool) -> int:
    """Remove only newly generated chunks; certify all original chunk payloads."""
    present = {region.name for region in (world / "region").glob("*.mca")}
    missing = set(inventory) - present
    if missing:
        raise ValueError(f"Conversion lost terrain regions: {sorted(missing)}")
    removed = 0
    upgrader = tool_config()["upgrader"]
    for name in sorted(present):
        region = world / "region" / name
        expected = set(inventory.get(name, []))
        if REGION.fullmatch(name) is None:
            raise ValueError(f"Unknown terrain region filename: {name}")
        # Vanilla can create a zero-length region handle during spawn setup.
        # Discard it only when this partition had no original chunks there.
        if not expected and region.stat().st_size == 0:
            region.unlink()
            continue
        with region.open("r+b") as stream:
            header = bytearray(stream.read(8192))
            entries = locations(header)
            if expected - entries.keys():
                raise ValueError(f"Conversion lost chunks: {name}")
            occupied = {0, 1}
            for index, (offset, count) in entries.items():
                sectors = set(range(offset, offset + count))
                if occupied & sectors or (offset + count) * 4096 > region.stat().st_size:
                    raise ValueError(f"Overlapping or truncated chunk sectors: {name}")
                occupied.update(sectors)
                if index not in expected:
                    header[index * 4 : index * 4 + 4] = b"\0" * 4
                    header[4096 + index * 4 : 4100 + index * 4] = b"\0" * 4
                    removed += 1
                    continue
                stream.seek(offset * 4096)
                length = int.from_bytes(stream.read(4), "big")
                if not 1 < length <= count * 4096 - 4:
                    raise ValueError(f"Invalid chunk length: {name}:{index}")
                compression = stream.read(1)
                payload = stream.read(length - 1)
                if compression == b"\x02":
                    data = zlib.decompress(payload)
                elif compression == b"\x01":
                    data = gzip.decompress(payload)
                elif compression == b"\x03":
                    data = payload
                else:
                    raise ValueError(f"Unsupported chunk compression: {name}:{index}")
                version = chunk_version(data)
                if converted and version != upgrader["dataVersion"]:
                    raise ValueError(f"Chunk was not converted to {upgrader['version']}: {name}:{index} ({version})")
            stream.seek(0)
            stream.write(header)
        if not expected:
            region.unlink()
    if terrain_inventory(world) != inventory:
        raise ValueError("Certified terrain inventory disagrees with the original")
    return removed


def upgrade_world(work: Path, jar: Path, image: str) -> None:
    (work / "eula.txt").write_text("eula=true\n")
    (work / "server.properties").write_text(
        "level-name=world\nserver-ip=127.0.0.1\nserver-port=25565\n"
        "online-mode=false\ngenerate-structures=false\nview-distance=2\n"
        "spawn-monsters=false\nspawn-animals=false\nspawn-npcs=false\n"
        "max-tick-time=-1\nenable-rcon=false\nenable-query=false\n"
    )
    identity = hashlib.sha256(str(work).encode()).hexdigest()[:12]
    name = f"storm-overview-{identity}"
    command = [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        "--hostname",
        "localhost",
        "--network",
        "none",
        "--cpus",
        "2",
        "--memory",
        "5g",
        "--mount",
        f"type=bind,src={work},dst=/data",
        "--mount",
        f"type=bind,src={jar},dst=/server.jar,readonly",
        "--mount",
        f"type=bind,src={jar.parent / 'upgrader-patch'},dst=/patch,readonly",
        "--workdir",
        "/data",
        "--entrypoint",
        "java",
        image,
        "-XX:ActiveProcessorCount=2",
        "-Xmx4G",
        "-cp",
        "/patch:/server.jar",
        "net.minecraft.server.Main",
        "--forceUpgrade",
        "--nogui",
        "--safeMode",
    ]
    log_path = work / f"upgrade-{len(list(work.glob('upgrade*.log'))) + 1}.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, text=True)
        reported = time.monotonic()
        try:
            while process.poll() is None:
                require_space(work)
                text = log_path.read_text(errors="replace")
                if re.search(r"\b(?:ERROR|FATAL)\b|Failed to (?:upgrade|load|read)", text):
                    raise RuntimeError(f"Upgrade logged a conversion failure; see {log_path}")
                if re.search(r"Preparing start region|Done \([\d.,]+s\)!", text):
                    raise RuntimeError(f"Offline converter unexpectedly started the server; see {log_path}")
                if time.monotonic() - reported >= 60:
                    progress = re.findall(r"\d+% completed \([\d /]+chunks\)", text)
                    if progress:
                        print(f"Converting {work.name}: {progress[-1]}", flush=True)
                    reported = time.monotonic()
                time.sleep(1)
            if process.returncode != 0 or CONVERSION_COMPLETE not in log_path.read_text():
                raise RuntimeError(f"Upgrade failed ({process.returncode}); see {log_path}")
            if re.search(r"\b(?:ERROR|FATAL)\b|Failed to (?:upgrade|load|read)", log_path.read_text()):
                raise RuntimeError(f"Upgrade logged a conversion failure; see {log_path}")
            if re.search(r"Preparing start region|Done \([\d.,]+s\)!", log_path.read_text()):
                raise RuntimeError(f"Offline converter unexpectedly started the server; see {log_path}")
        finally:
            if process.poll() is None:
                subprocess.run(["docker", "stop", "--time", "180", name], check=True, capture_output=True)
                process.wait(timeout=190)


def upgrade_regions(work: Path, jar: Path, image: str, workers: int) -> int:
    """Upgrade disjoint region files in bounded, isolated vanilla processes."""
    if workers == 1:
        if (work / "upgrade").exists():
            raise ValueError("Resume conversion with the original worker count")
        upgrade_world(work, jar, image)
        return 0
    capacity = subprocess.check_output(["docker", "info", "--format", "{{.NCPU}} {{.MemTotal}}"], text=True).split()
    if int(capacity[0]) < 2 * workers or int(capacity[1]) < (5 * workers + 2) * 1024**3:
        raise RuntimeError("Docker capacity is insufficient for this conversion worker count")
    inventory: TerrainInventory = json.loads((work / "inventory.json").read_text())
    groups: list[TerrainInventory] = [{} for _ in range(workers)]
    totals = [0] * workers
    for name, indices in sorted(inventory.items(), key=lambda item: (-len(item[1]), item[0])):
        index = min(range(workers), key=lambda index: totals[index])
        groups[index][name] = indices
        totals[index] += len(indices)
    groups = [group for group in groups if group]
    root = work / "upgrade"
    root.mkdir(exist_ok=True)
    plan_path = root / "plan.json"
    plan = {"workers": workers, "groups": groups}
    if plan_path.exists() and json.loads(plan_path.read_text()) != plan:
        raise ValueError("Conversion partition plan changed; resume with the original worker count")
    write_json(plan_path, plan)
    parts = []
    for index, group in enumerate(groups):
        part = root / f"part-{index}"
        (part / "world/region").mkdir(parents=True, exist_ok=True)
        if not (part / "world/level.dat").exists():
            shutil.copyfile(work / "world/level.dat", part / "world/level.dat")
        if not (part / "converted.json").exists():
            for name in group:
                src, dst = work / "world/region" / name, part / "world/region" / name
                if src.exists() and dst.exists():
                    raise ValueError(f"Duplicate conversion input: {name}")
                if src.exists():
                    src.rename(dst)
                if not dst.exists():
                    raise ValueError(f"Missing conversion input: {name}")
        parts.append((part, group))

    def convert(task: tuple[Path, TerrainInventory]) -> int:
        part, group = task
        certificate = part / "converted.json"
        if certificate.exists():
            removed = json.loads(certificate.read_text())["generatedChunksRemoved"]
            if not isinstance(removed, int) or removed < 0:
                raise ValueError("Invalid partition conversion certificate")
            return removed
        upgrade_world(part, jar, image)
        removed = certify_terrain(part / "world", group, converted=True)
        write_json(certificate, {"generatedChunksRemoved": removed})
        return removed

    with ThreadPoolExecutor(max_workers=workers) as pool:
        removed = sum(pool.map(convert, parts))
    # Completed partitions contain only their original regions. A partial
    # merge is resumable; the caller certifies the combined chunk inventory.
    for part, group in parts:
        for name in group:
            src, dst = part / "world/region" / name, work / "world/region" / name
            if src.exists() and dst.exists():
                raise ValueError(f"Duplicate converted region: {name}")
            if src.exists():
                src.rename(dst)
            if not dst.exists():
                raise ValueError(f"Conversion lost a region: {name}")
    shutil.copyfile(parts[0][0] / "world/level.dat", work / "world/level.dat")
    return removed


def write_configs(work: Path, world: NamedWorld, spawn: tuple[int, int], workers: int) -> None:
    config = work / "config"
    for directory in (config, config / "maps", config / "storages"):
        directory.mkdir(exist_ok=True)
    files = {
        "core.conf": f'accept-download: true\ndata: "data"\nrender-thread-count: {workers}\n'
        "render-thread-priority: 1\nscan-for-mod-resources: false\nmetrics: false\n",
        "webapp.conf": 'enabled: true\nwebroot: "web"\ndefault-to-flat-view: true\n'
        "use-cookies: false\nclient-decompression: true\n"
        "hires-slider-max: 0\nhires-slider-default: 0\nhires-slider-min: 0\n",
        "webserver.conf": 'enabled: false\nwebroot: "web"\n',
        "storages/file.conf": 'storage-type: file\nroot: "web/maps"\ncompression: gzip\n',
        f"maps/{world['id']}.conf": 'world: "world"\ndimension: "minecraft:overworld"\n'
        f"name: {json.dumps(world['title'])}\nstart-pos: {{ x: {spawn[0]}, z: {spawn[1]} }}\n"
        'storage: "file"\nenable-hires: false\nenable-flat-view: true\n'
        "enable-perspective-view: false\nenable-free-flight-view: false\nmin-inhabited-time: 0\n"
        "ignore-missing-light-data: true\n",
    }
    for relative, text in files.items():
        (config / relative).write_text(text, encoding="utf-8")


def render_world(work: Path, jar: Path, version: str, workers: int, *, java: str) -> None:
    log_path = work / f"render-{len(list(work.glob('render*.log'))) + 1}.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            [
                java,
                f"-XX:ActiveProcessorCount={workers}",
                f"-Xmx{8 if workers > 4 else 4}G",
                "-cp",
                f"{jar.parent / 'renderer-patch'}{os.pathsep}{jar}",
                "de.bluecolored.bluemap.cli.BlueMapCLI",
                "-c",
                "config",
                "-v",
                version,
                "-r",
                "-g",
                "-s",
            ],
            cwd=work,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        reported = time.monotonic()
        try:
            while process.poll() is None:
                require_space(work)
                if time.monotonic() - reported >= 60:
                    progress = re.findall(r"updating map '[^']+': [^\n]+", log_path.read_text(errors="replace"))
                    if progress:
                        print(progress[-1], flush=True)
                    reported = time.monotonic()
                time.sleep(1)
            if process.returncode != 0:
                raise RuntimeError(f"BlueMap failed ({process.returncode}); see {log_path}")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    text = log_path.read_text(errors="replace")
    if re.search(r"\b(?:ERROR|FATAL)\b|Failed to (?:render|load|read)", text):
        raise RuntimeError(f"BlueMap logged a rendering failure; see {log_path}")
    root = work / "web"
    if not (root / "index.html").is_file() or not list(root.glob("maps/*/tiles/**/*.png")):
        raise ValueError("BlueMap produced no viewer or overview tiles")
    if list(root.rglob("*.prbm*")):
        raise ValueError("Low-resolution output unexpectedly contains 3D tiles")
    certify_render_states(root, json.loads((work / "inventory.json").read_text()))


def certify_render_states(root: Path, inventory: TerrainInventory | None = None) -> None:
    """Fail on silently omitted light data or failed tiles in pinned BlueMap NBT."""
    files = list(root.glob("maps/*/rstate/**/*.tiles.dat"))
    if not files:
        raise ValueError("BlueMap produced no render-state certificates")
    rendered = 0
    processed: dict[tuple[int, int], bytes] = {}
    allowed = {"bluemap:rendered", "bluemap:not-generated", "bluemap:unknown"}
    for path in files:
        reader = NbtReader(gzip.decompress(path.read_bytes()))
        if reader.read(1) != b"\x0a":
            raise ValueError("Render state must be an NBT compound")
        reader.string()
        palette: list[str] = []
        data = b""
        while (kind := reader.read(1)[0]) != 0:
            name = reader.string()
            if name != "tile-states" or kind != 10:
                reader.skip(kind)
                continue
            while (child := reader.read(1)[0]) != 0:
                name = reader.string()
                if name == "palette" and child == 9:
                    if reader.read(1) != b"\x08":
                        raise ValueError("Render-state palette must contain strings")
                    count = reader.integer()
                    if not 0 < count <= 256:
                        raise ValueError("Invalid render-state palette size")
                    palette = [reader.string() for _ in range(count)]
                elif name == "data" and child == 7:
                    if reader.integer() != 1024:
                        raise ValueError("Invalid render-state tile count")
                    data = reader.read(1024)
                else:
                    reader.skip(child)
        if not palette or not data or max(data) >= len(palette):
            raise ValueError("Incomplete render-state certificate")
        states = {palette[index] for index in data}
        if states - allowed:
            raise ValueError(f"Overview contains omitted or failed tiles: {sorted(states - allowed)} ({path})")
        rendered += sum(palette[index] == "bluemap:rendered" for index in data)
        # FileGridStorage shards decimal coordinates after every digit.
        # Rejoin the path exactly as upstream's storage reader does.
        encoded = "".join(path.relative_to(root).parts[3:])
        position = re.fullmatch(r"x(-?\d+)z(-?\d+)\.tiles\.dat", encoded)
        if position is None:
            raise ValueError("Unknown render-state region filename")
        coordinate = int(position[1]), int(position[2])
        if coordinate in processed:
            raise ValueError("Duplicate render-state region coordinate")
        processed[coordinate] = bytes(palette[index] == "bluemap:rendered" for index in data)
    if rendered == 0:
        raise ValueError("Overview contains no rendered terrain")
    if inventory is not None:
        settings = list(root.glob("maps/*/settings.json"))
        if len(settings) != 1:
            raise ValueError("Expected one independently rendered world")
        grid = json.loads(settings[0].read_text())["hires"]
        if grid != {"tileSize": [32, 32], "scale": [1, 1], "translate": [2, 2]}:
            raise ValueError("Pinned renderer tile grid changed")
        # Every saved chunk must have a rendered tile, including terrain whose
        # old population or lighting metadata claims it was never generated.
        for name, indices in inventory.items():
            region = REGION.fullmatch(name)
            if region is None:
                raise ValueError("Unknown inventory region filename")
            rx, rz = int(region[1]), int(region[2])
            for index in indices:
                x = (16 * (rx * 32 + index % 32) + 8 - 2) // 32
                z = (16 * (rz * 32 + index // 32) + 8 - 2) // 32
                states = processed.get((x // 32, z // 32))
                if states is None or not states[(z % 32) * 32 + x % 32]:
                    raise ValueError(f"Saved chunk has no rendered overview tile: {name}:{index}")


def asset_inventory(root: Path) -> list[Asset]:
    result: list[Asset] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlink in generated web payload")
        if path.is_file():
            relative = path.relative_to(root)
            if relative.as_posix() == "sql.php" or "rstate" in relative.parts:
                continue
            result.append({"path": relative.as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)})
    return result


def publish_asset(profile: str, root: Path, prefix: str, asset: Asset) -> None:
    key = f"{prefix}/{asset['path']}"
    path = root / asset["path"]
    if path.stat().st_size != asset["bytes"] or sha256(path) != asset["sha256"]:
        raise ValueError(f"Rendered asset changed: {asset['path']}")
    existing = aws(profile, ["s3api", "list-objects-v2", "--bucket", BUCKET, "--prefix", key], capture_output=True)
    if any(item["Key"] == key for item in json.loads(existing.stdout).get("Contents", [])):
        verify_checkpoint(profile, f"{ORIGIN}/{key}", asset["bytes"], asset["sha256"])
        verify_url(key)
        return
    # client-decompression requests the .gz object and decompresses its bytes
    # itself: do not set Content-Encoding, which would decompress them twice.
    if path.suffix == ".gz":
        content_type = "application/gzip"
    elif path.suffix == ".map":
        json.loads(path.read_text(encoding="utf-8"))
        content_type = "application/json"
    elif path.suffix == ".conf" and asset["path"].startswith("lang/"):
        content_type = "text/plain; charset=utf-8"
    else:
        content_type = mimetypes.guess_type(path.name)[0]
    if content_type is None:
        raise ValueError(f"Unknown public asset content type: {path.name}")
    aws(
        profile,
        [
            "s3",
            "cp",
            str(path),
            f"s3://{BUCKET}/{key}",
            "--only-show-errors",
            "--cache-control",
            "public,max-age=31536000,immutable",
            "--content-type",
            content_type,
            "--content-disposition",
            "inline",
            "--metadata",
            f"sha256={asset['sha256']}",
        ],
    )
    command = [
        "aws",
        "--profile",
        profile,
        "--endpoint-url",
        ENDPOINT,
        "s3",
        "cp",
        f"s3://{BUCKET}/{key}",
        "-",
        "--only-show-errors",
    ]
    with subprocess.Popen(command, stdout=subprocess.PIPE, env=AWS_ENV) as process:
        if process.stdout is None:
            raise RuntimeError("S3 readback pipe is missing")
        digest = stream_sha256(process.stdout)
        if process.wait() != 0 or digest != asset["sha256"]:
            raise RuntimeError(f"S3 readback mismatch: {key}")
    verify_url(key)


def validate_publication(state: OverviewPublication, *, complete: bool = False) -> None:
    catalog, tools = load_catalog(), tool_config()
    if state["archiveRelease"] != catalog["release"] or state["overviewRelease"] != tools["release"]:
        raise ValueError("Overview publication belongs to another release")
    if state["tools"] != tools:
        raise ValueError("Overview publication tool pins changed")
    ids = {world["id"] for world in listed_worlds(catalog)}
    if not set(state["worlds"]) <= ids or (complete and set(state["worlds"]) != ids):
        raise ValueError("Overview publication does not contain the required worlds")
    downloads: ArchivePublication = json.loads((PACKAGE / "archive/published.json").read_text())
    for identifier, world in state["worlds"].items():
        expected = f"{ORIGIN}/world-archive/{catalog['release']}/overviews/{tools['release']}/{identifier}"
        if (
            world["url"] != f"{expected}/index.html"
            or world["sourceSha256"] != downloads["worlds"][identifier]["sourceSha256"]
        ):
            raise ValueError(f"Overview does not match the certified archive: {identifier}")
        names = []
        for asset in world["assets"]:
            safe_parts(asset["path"])
            names.append(asset["path"])
            if asset["bytes"] <= 0 or not re.fullmatch(r"[a-f0-9]{64}", asset["sha256"]):
                raise ValueError("Invalid overview asset certificate")
        if len(names) != len(set(names)) or "index.html" not in names:
            raise ValueError("Overview assets must be unique and include the viewer")
        if world["bytes"] != sum(asset["bytes"] for asset in world["assets"]) or world["objects"] != len(names):
            raise ValueError("Overview size certificate disagrees with its assets")


def verify(state: OverviewPublication, profile: str, *, readback: bool = False) -> None:
    validate_publication(state)
    tasks = [
        (world["url"].removesuffix("/index.html"), asset)
        for world in state["worlds"].values()
        for asset in world["assets"]
    ]

    def check(task: tuple[str, Asset]) -> None:
        root, asset = task
        url = f"{root}/{asset['path']}"
        verify_checkpoint(profile, url, asset["bytes"], asset["sha256"])
        verify_url(url.removeprefix(f"{ORIGIN}/"))
        if readback:
            request = urllib.request.Request(url, headers={"User-Agent": "StormWorldArchive/1.0"})
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status != 200 or stream_sha256(response) != asset["sha256"]:
                    raise ValueError(f"Public readback mismatch: {url}")

    with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as pool:
        for count, _ in enumerate(pool.map(check, tasks), start=1):
            if count % 250 == 0:
                print(f"Verifying public overview assets: {count}/{len(tasks)}", flush=True)
    print(f"Verified {len(tasks)} public overview assets", flush=True)


def run(args: argparse.Namespace) -> None:
    source, scratch = args.source.resolve(), args.scratch.resolve()
    if scratch.is_relative_to(source) or source.is_relative_to(scratch) or scratch.is_relative_to(REPO):
        raise ValueError("Scratch must be outside the repository and source directory")
    if args.dry_run:
        run_locked(args)
        return
    if scratch.exists() and not (scratch / ".overview-scratch-owner").exists() and any(scratch.iterdir()):
        raise ValueError("Refusing to use a nonempty, unowned scratch directory")
    scratch.mkdir(parents=True, exist_ok=True)
    with (scratch / ".run.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another overview run owns this scratch directory") from error
        run_locked(args)


def run_locked(args: argparse.Namespace) -> None:
    catalog, tools = load_catalog(), tool_config()
    source, scratch = args.source.resolve(), args.scratch.resolve()
    if scratch.is_relative_to(source) or source.is_relative_to(scratch) or scratch.is_relative_to(REPO):
        raise ValueError("Scratch must be outside the repository and source directory")
    worlds = [world for world in listed_worlds(catalog) if not args.only or world["id"] == args.only]
    archive: ArchivePublication = json.loads((PACKAGE / "archive/published.json").read_text())
    downloads = archive["worlds"]
    render_workers = args.render_workers or args.workers
    cpus = os.cpu_count()
    if cpus is None or render_workers > cpus:
        raise ValueError("Native CPU capacity is insufficient for this render worker count")
    if args.dry_run:
        for world in worlds:
            with zipfile.ZipFile(source / world["file"]) as zipped:
                terrain = [item for item in zipped.infolist() if item.filename.startswith(world["root"] + "/region/")]
            print(
                f"{world['id']}: {sum(item.file_size for item in terrain) / 1024**3:.2f} GiB terrain; "
                f"render format {native_version(world) or tools['upgrader']['version']}"
            )
        print("All saved overworld terrain; one world at a time; 15 GiB scratch reserve; low-resolution only.")
        return
    scratch.mkdir(parents=True, exist_ok=True)
    owner = {"source": str(source), "archiveRelease": catalog["release"], "tools": tools}
    marker = scratch / ".overview-scratch-owner"
    if marker.exists() and json.loads(marker.read_text()) != owner:
        raise ValueError("Scratch belongs to another source, tool pin, or overview release")
    write_json(marker, owner)
    require_space(scratch)
    java = subprocess.check_output(["mise", "which", "java"], cwd=REPO, text=True).strip()
    aws(args.profile, ["s3api", "head-bucket", "--bucket", BUCKET])
    bluemap = fetch_tool(scratch, "bluemap", tools["bluemap"])
    upgrader = fetch_tool(scratch, "upgrader", tools["upgrader"])
    subprocess.run(
        [
            java,
            "-cp",
            str(upgrader),
            str(PACKAGE / "scripts/PatchUpgrader.java"),
            str(upgrader),
            str(upgrader.parent / "upgrader-patch"),
        ],
        check=True,
    )
    subprocess.run(
        [
            java,
            "-cp",
            str(bluemap),
            str(PACKAGE / "scripts/PatchRenderer.java"),
            str(bluemap),
            str(bluemap.parent / "renderer-patch"),
        ],
        check=True,
    )
    viewer = build_viewer(scratch, fetch_tool(scratch, "webapp", tools["webapp"]))
    state_path = scratch / "overviews.json"
    state: OverviewPublication = (
        json.loads(state_path.read_text())
        if state_path.exists()
        else {
            "archiveRelease": catalog["release"],
            "overviewRelease": tools["release"],
            "tools": tools,
            "worlds": {},
        }
    )
    validate_publication(state)
    for world in sorted(worlds, key=lambda item: (source / item["file"]).stat().st_size):
        identifier = world["id"]
        source_hash = sha256(source / world["file"])
        if source_hash != downloads[identifier]["sourceSha256"]:
            raise ValueError(f"Source disagrees with the certified download: {identifier}")
        if identifier in state["worlds"]:
            verify({**state, "worlds": {identifier: state["worlds"][identifier]}}, args.profile)
            print(f"Already certified: {identifier}", flush=True)
            continue
        work = scratch / identifier
        work.mkdir(exist_ok=True)
        checkpoint_path = work / "checkpoint.json"
        checkpoint: Checkpoint = (
            json.loads(checkpoint_path.read_text())
            if checkpoint_path.exists()
            else {
                "phase": "new",
                "sourceSha256": source_hash,
                "spawn": [],
                "chunks": 0,
                "generatedChunksRemoved": 0,
                "assets": [],
            }
        )
        if checkpoint["phase"] == "new":
            if (work / "world").exists():
                raise RuntimeError(f"Unfinished extraction: inspect {work} before retrying")
            print(f"Extracting {identifier}", flush=True)
            inventory, spawn = extract_world(source, world, work)
            checkpoint.update(
                phase="extracted", spawn=list(spawn), chunks=sum(len(indices) for indices in inventory.values())
            )
            write_json(checkpoint_path, checkpoint)
        if checkpoint["sourceSha256"] != source_hash:
            raise ValueError("Checkpoint source changed")
        if checkpoint["phase"] == "extracted":
            removed = 0
            if native_version(world) is None:
                print(f"Upgrading disposable {identifier} to {tools['upgrader']['version']}", flush=True)
                removed = upgrade_regions(work, upgrader, tools["javaImage"], args.workers)
            inventory = json.loads((work / "inventory.json").read_text())
            removed += certify_terrain(work / "world", inventory, converted=native_version(world) is None)
            checkpoint.update(phase="converted", generatedChunksRemoved=removed)
            write_json(checkpoint_path, checkpoint)
        if checkpoint["phase"] == "converted":
            write_configs(work, world, (checkpoint["spawn"][0], checkpoint["spawn"][1]), render_workers)
            version = native_version(world) or tools["upgrader"]["version"]
            print(f"Rendering low-resolution {identifier} ({checkpoint['chunks']:,} saved chunks)", flush=True)
            render_world(work, bluemap, version, render_workers, java=java)
            install_viewer(viewer, work / "web")
            assets = asset_inventory(work / "web")
            checkpoint.update(phase="rendered", assets=assets)
            write_json(checkpoint_path, checkpoint)
        if checkpoint["phase"] != "rendered":
            raise ValueError("Unknown overview checkpoint phase")
        if sha256(source / world["file"]) != source_hash:
            raise ValueError("Original archive changed during rendering")
        prefix = f"world-archive/{catalog['release']}/overviews/{tools['release']}/{identifier}"
        assets = checkpoint["assets"]
        print(
            f"Publishing {identifier}: {len(assets)} objects, {sum(a['bytes'] for a in assets) / CHUNK:.1f} MiB",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as pool:
            for _ in pool.map(partial(publish_asset, args.profile, work / "web", prefix), assets):
                pass
        state["worlds"][identifier] = {
            "sourceSha256": source_hash,
            "renderMinecraft": native_version(world) or tools["upgrader"]["version"],
            "url": f"{ORIGIN}/{prefix}/index.html",
            "chunks": checkpoint["chunks"],
            "generatedChunksRemoved": checkpoint["generatedChunksRemoved"],
            "bytes": sum(asset["bytes"] for asset in assets),
            "objects": len(assets),
            "assets": assets,
        }
        write_json(state_path, state)
        # Delete only this pipeline-owned world's data after certification.
        # Keep its configs, checkpoints and logs for operator inspection.
        for directory in (work / "world", work / "data", *work.glob("upgrade/part-*/world")):
            if directory.is_dir():
                shutil.rmtree(directory)
        print(f"Certified {identifier}", flush=True)
    print(
        f"Total certified payload: {sum(world['bytes'] for world in state['worlds'].values()) / CHUNK:.1f} MiB",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    publish = commands.add_parser("run")
    publish.add_argument("--source", type=Path, required=True)
    publish.add_argument("--scratch", type=Path, required=True)
    publish.add_argument("--only", choices=[world["id"] for world in listed_worlds(load_catalog())])
    publish.add_argument("--workers", type=int, choices=range(1, 6), default=2)
    publish.add_argument(
        "--render-workers",
        type=int,
        choices=(1, 2, 4, 8, 12),
        help="Native render threads; defaults to the conversion worker count",
    )
    publish.add_argument("--profile", default="seaweedfs")
    publish.add_argument("--dry-run", action="store_true")
    for command in ("document", "verify"):
        child = commands.add_parser(command)
        child.add_argument("--state", type=Path, required=True)
        child.add_argument("--profile", default="seaweedfs")
        child.add_argument("--readback", action="store_true", help="Also verify every asset's public bytes")
    args = parser.parse_args()
    if args.command == "run":
        run(args)
    else:
        state = json.loads(args.state.read_text(encoding="utf-8"))
        if args.command == "verify":
            verify(state, args.profile, readback=args.readback)
        else:
            validate_publication(state, complete=True)
            verify(state, args.profile, readback=args.readback)
            write_json(PUBLICATION_PATH, state)
            document_archive(PACKAGE / "archive/published.json", PUBLICATION_PATH)


if __name__ == "__main__":
    main()
