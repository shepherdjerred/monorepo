#!/usr/bin/env python3
"""Prepare immutable archive evidence and compare offline rollback copies. Never activates a world."""

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import selectors
import shutil
import sqlite3
import stat
import struct
import subprocess
import time
import uuid
import zipfile
from contextlib import ExitStack, closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from restoration_json import JsonObject

ARCHIVE_SHA256 = "89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa"
ARCHIVE_ROOT = "home/files/servers/survival/world/"
EXPECTED_CHUNKS = 638_647
EXPECTED_PLAYERS = 4_413
JOURNAL = "restore-journal.json"
PAPER_1217_SHA256 = "83838188699cb2837e55b890fb1a1d39ad0710285ed633fbf9fc14e9f47ce078"

backup_spec = importlib.util.spec_from_file_location(
    "restoration_backup", Path(__file__).with_name("restoration_backup.py")
)
if backup_spec is None or backup_spec.loader is None:
    raise RuntimeError("Restoration backup contract is unavailable")
backup_contract = importlib.util.module_from_spec(backup_spec)
backup_spec.loader.exec_module(backup_contract)


@contextmanager
def operation_lock(staging: Path):
    """One converter owns a staging journal at a time, including its input-verification phase."""
    root = staging.resolve(strict=True)
    descriptor = os.open(root / ".restore-operation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+b") as handle:
        try:
            fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("Another restoration operation owns this staging journal") from error
        yield


def conversion_configuration(root: Path, guard: Path) -> None:
    """No gameplay plugins, players, public listener or other dimensions enter the converter."""
    plugins = root / "plugins"
    plugins.mkdir(exist_ok=True)
    if list(plugins.iterdir()):
        raise ValueError("Conversion plugins directory must be empty")
    shutil.copy2(guard, plugins / "StormConversionGuard.jar")
    (root / "eula.txt").write_text("eula=true\n", encoding="utf-8")
    (root / "server.properties").write_text(
        "server-ip=127.0.0.1\nserver-port=25585\nonline-mode=false\n"
        "white-list=true\nenforce-whitelist=true\nmax-players=0\n"
        "enable-rcon=false\nenable-query=false\nallow-nether=false\n"
        "level-name=world\nview-distance=2\nsimulation-distance=2\n"
        "spawn-protection=0\nspawn-animals=false\nspawn-monsters=false\nspawn-npcs=false\n",
        encoding="utf-8",
    )
    (root / "bukkit.yml").write_text("settings:\n  allow-end: false\n", encoding="utf-8")


def run_converter(root: Path, paper: Path, log: Path, timeout: float = 3600, force_upgrade: bool = True) -> None:
    """Fail closed on any server error; retain the failed copy and complete console evidence."""
    ready, verified, done, stop_sent = False, False, False, False
    pending = ""
    deadline = time.monotonic() + timeout
    with (
        log.open("x", encoding="utf-8") as output,
        subprocess.Popen(
            ["java", "-Xms1G", "-Xmx4G", "-jar", str(paper), "--nogui"] + (["--forceUpgrade"] if force_upgrade else []),
            cwd=root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        ) as process,
    ):
        if process.stdout is None or process.stdin is None:
            raise RuntimeError("Converter console pipes are unavailable")
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Conversion exceeded its bounded deadline")
                    for key, _ in selector.select(timeout=1):
                        block = os.read(key.fd, 65536).decode("utf-8", errors="replace")
                        if not block:
                            continue
                        output.write(block)
                        output.flush()
                        lines = (pending + block).split("\n")
                        pending = lines.pop()
                        for line in lines:
                            if " ERROR]" in line or "ERROR]:" in line or "Exception" in line:
                                raise ValueError("Paper reported a conversion error; inspect the private log")
                            if "CONVERSION_GUARD_READY:" in line:
                                ready = True
                            if 'Preparing level "world"' in line and not ready:
                                raise ValueError("World initialization preceded conversion guard readiness")
                            verified |= "CONVERSION_GUARD_VERIFIED: frozen=true; players=0" in line
                            done |= "Done (" in line
                        if done and verified and not stop_sent:
                            process.stdin.write("stop\n")
                            process.stdin.flush()
                            stop_sent = True
                remaining = process.stdout.read()
                output.write(remaining)
                if " ERROR]" in remaining or "ERROR]:" in remaining or "Exception" in remaining:
                    raise ValueError("Paper reported an error during conversion shutdown")
                if process.returncode != 0 or not (ready and verified and done and stop_sent):
                    raise ValueError("Converter did not complete a guarded startup and clean shutdown")
        except BaseException:
            if process.poll() is None:
                process.stdin.write("stop\n")
                process.stdin.flush()
                try:
                    remaining, _ = process.communicate(timeout=60)
                except subprocess.TimeoutExpired:
                    process.kill()
                    remaining, _ = process.communicate()
                output.write(remaining)
            raise
        finally:
            output.flush()
            os.fsync(output.fileno())


def convert_legacy(staging: Path, paper: Path, guard: Path) -> None:
    staging, paper, guard = (path.resolve(strict=True) for path in (staging, paper, guard))
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "PREPARED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Conversion requires the untouched PREPARED archive copy")
    if digest(paper) != PAPER_1217_SHA256:
        raise ValueError("Converter is not pinned Paper 1.21.7 build 32")
    expected = json.loads((staging / "source-files.json").read_text(encoding="utf-8"))
    if fingerprint(staging / "source") != expected:
        raise ValueError("Extracted archive source changed after preparation")
    root = staging / "conversion-1.21.7"
    if fingerprint(root) != expected:
        raise ValueError("Conversion copy is not identical to the prepared source")
    conversion_configuration(root, guard)
    receipt.update(
        phase="LEGACY_CHUNKS_CONVERTING",
        paperSha256=digest(paper),
        guardSha256=digest(guard),
        playerConversion="PENDING",
    )
    save_json(staging / JOURNAL, receipt)
    try:
        run_converter(root, paper, staging / "conversion-1.21.7.log")
        before = json.loads((staging / "source-chunks.json").read_text(encoding="utf-8"))
        after = chunk_inventory(root / "world/region")
        if not before.keys() <= after.keys():
            raise ValueError("Conversion removed original chunks")
        if fingerprint(staging / "source") != expected:
            raise ValueError("Conversion modified the extracted archive source")
        save_json(staging / "converted-1.21.7-chunks.json", after)
        receipt.update(
            phase="LEGACY_CHUNKS_CONVERTED",
            convertedChunks=len(after),
            conversionLogSha256=digest(staging / "conversion-1.21.7.log"),
        )
    except BaseException:
        receipt["phase"] = "LEGACY_CONVERSION_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def conversion_classpath(root: Path, paper: Path, version: str = "1.21.7") -> str:
    """Only Paper's checksummed bootstrap artifacts enter the offline Java tool's classpath."""
    if version == "1.21.7":
        expected_hash = PAPER_1217_SHA256
    elif version == "26.2":
        pin = json.loads(Path(__file__).with_name("plugins.json").read_text(encoding="utf-8"))["paper"]
        if pin["version"] != "26.2-129":
            raise ValueError("Native converter requires the rehearsed Paper 26.2 build 129")
        expected_hash = pin["sha256"]
    else:
        raise ValueError("Unsupported conversion checkpoint")
    if digest(paper) != expected_hash:
        raise ValueError("Conversion requires the exact pinned Paper artifact")
    with zipfile.ZipFile(paper) as archive:
        libraries = archive.read("META-INF/libraries.list").decode("utf-8").splitlines()
        patches = archive.read("META-INF/patches.list").decode("utf-8").splitlines()
    entries = [(line.split("\t")[0], root / "libraries" / line.split("\t")[2]) for line in libraries]
    versions = [line.split("\t") for line in patches if line.startswith("versions\t")]
    if len(versions) != 1 or versions[0][6] != f"{version}/paper-{version}.jar":
        raise ValueError("Unexpected Paper bootstrap version manifest")
    entries.insert(0, (versions[0][3], root / "versions" / versions[0][6]))
    for checksum, path in entries:
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
            raise ValueError("Bootstrap artifact is outside the isolated converter")
        if digest(path) != checksum:
            raise ValueError("Bootstrap artifact checksum differs from pinned Paper manifest")
    return os.pathsep.join(str(path) for _, path in entries)


def convert_native_chunks(staging: Path, paper: Path, bootstrap: Path) -> None:
    staging, paper, bootstrap = (path.resolve(strict=True) for path in (staging, paper, bootstrap))
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "COMPANION_DATA_CONVERTED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Native chunk conversion requires the verified legacy companion checkpoint")
    classpath = conversion_classpath(bootstrap, paper, "26.2")
    source = Path(__file__).resolve().parent / "conversion/NativeChunkConverter.java"
    source_hash = digest(source)
    region = staging / "conversion-1.21.7/world/region"
    before = chunk_inventory(region)
    expected = json.loads((staging / "converted-1.21.7-chunks.json").read_text(encoding="utf-8"))
    if before != expected:
        raise ValueError("Legacy chunk checkpoint changed")
    output = staging / "native-chunks-26.2"
    if output.exists():
        raise ValueError("Native output already exists; inspect its conversion receipt")
    receipt.update(phase="NATIVE_CHUNKS_CONVERTING", nativePaperSha256=digest(paper), nativeChunkToolSha256=source_hash)
    save_json(staging / JOURNAL, receipt)
    try:
        with (staging / "native-chunk-conversion.log").open("x", encoding="utf-8") as log:
            result = subprocess.run(
                ["java", "-Xmx2G", "--class-path", classpath, str(source), str(region), str(output)],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=7200,
            )
            log.flush()
            os.fsync(log.fileno())
        if result.returncode != 0:
            raise ValueError("Native chunk conversion failed; inspect the private log")
        converted = json.loads((output / "conversion-receipt.json").read_text(encoding="utf-8"))
        after = chunk_inventory(output)
        if before.keys() != after.keys() or converted["chunks"] != EXPECTED_CHUNKS:
            raise ValueError("Native conversion changed the archive's complete chunk footprint")
        if converted["dataVersion"] != 4903 or converted["terrainGeneration"] or converted["worldTicks"]:
            raise ValueError("Native conversion violated the pinned offline conversion contract")
        if digest(source) != source_hash or chunk_inventory(region) != before:
            raise ValueError("Native tool or legacy checkpoint changed during conversion")
        save_json(staging / "native-chunks-26.2-files.json", fingerprint(output))
        receipt.update(
            phase="NATIVE_CHUNKS_CONVERTED",
            nativeChunkReceiptSha256=digest(output / "conversion-receipt.json"),
            nativeChunks=len(after),
        )
    except BaseException:
        receipt["phase"] = "NATIVE_CHUNK_CONVERSION_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def convert_companions(staging: Path, paper: Path) -> None:
    staging, paper = staging.resolve(strict=True), paper.resolve(strict=True)
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "LEGACY_CHUNKS_CONVERTED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Companion conversion requires the guarded legacy chunk checkpoint")
    expected = json.loads((staging / "source-files.json").read_text(encoding="utf-8"))
    if fingerprint(staging / "source") != expected:
        raise ValueError("Extracted archive source changed")
    root = staging / "conversion-1.21.7"
    classpath = conversion_classpath(root, paper)
    source = Path(__file__).resolve().parent / "conversion/LegacyDataConverter.java"
    source_hash = digest(source)
    output = staging / "companion-data-1.21.7"
    if output.exists():
        raise ValueError("Companion output already exists; retain and inspect its receipt")
    receipt.update(phase="COMPANION_DATA_CONVERTING", companionToolSha256=source_hash)
    save_json(staging / JOURNAL, receipt)
    try:
        with (staging / "companion-conversion-1.21.7.log").open("x", encoding="utf-8") as log:
            result = subprocess.run(
                ["java", "-Xmx2G", "--class-path", classpath, str(source), str(staging / "source/world"), str(output)],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=600,
            )
            log.flush()
            os.fsync(log.fileno())
        if result.returncode != 0:
            raise ValueError("Companion conversion failed; inspect the private conversion log")
        converted = json.loads((output / "conversion-receipt.json").read_text(encoding="utf-8"))
        for directory in ("playerdata", "stats"):
            before = {
                path.name
                for path in (staging / "source/world" / directory).iterdir()
                if path.suffix in (".dat", ".json")
            }
            after = {path.name for path in (output / directory).iterdir()}
            if before != after or len(before) != EXPECTED_PLAYERS:
                raise ValueError("Companion conversion did not preserve every player identity")
        if digest(source) != source_hash or fingerprint(staging / "source") != expected:
            raise ValueError("Converter source or extracted archive changed during conversion")
        if converted["dataVersion"] != 4438:
            raise ValueError("Companion output does not match pinned 1.21.7 data version")
        save_json(staging / "companion-data-1.21.7-files.json", fingerprint(output))
        receipt.update(
            phase="COMPANION_DATA_CONVERTED",
            playerConversion="PAPER_1217_VERIFIED",
            companionReceiptSha256=digest(output / "conversion-receipt.json"),
        )
    except BaseException:
        receipt["phase"] = "COMPANION_CONVERSION_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def convert_native_companions(staging: Path, paper: Path, bootstrap: Path) -> None:
    staging, paper, bootstrap = (path.resolve(strict=True) for path in (staging, paper, bootstrap))
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "NATIVE_CHUNKS_CONVERTED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Native companion conversion requires the verified native terrain checkpoint")
    classpath = conversion_classpath(bootstrap, paper, "26.2")
    conversion = Path(__file__).resolve().parent / "conversion"
    sources = [conversion / name for name in ("NativeCompanionConverter.java", "NativeTerrain.java")]
    source_hashes = {path.name: digest(path) for path in sources}
    inputs = {
        "source": "source-files.json",
        "companion-data-1.21.7": "companion-data-1.21.7-files.json",
        "native-chunks-26.2": "native-chunks-26.2-files.json",
    }
    manifests = {
        root: json.loads((staging / manifest).read_text(encoding="utf-8")) for root, manifest in inputs.items()
    }
    for root, expected in manifests.items():
        if fingerprint(staging / root) != expected:
            raise ValueError("A verified native companion input changed")
    output = staging / "native-companion-data-26.2"
    if output.exists():
        raise ValueError("Native companion output already exists; retain and inspect its receipt")
    receipt.update(phase="NATIVE_COMPANION_DATA_CONVERTING", nativeCompanionToolSha256=source_hashes)
    save_json(staging / JOURNAL, receipt)
    try:
        with (staging / "native-companion-conversion.log").open("x", encoding="utf-8") as log:
            command = ["java", "-Xmx2G", "--class-path", classpath, str(sources[0])]
            testing = subprocess.run([*command, "--self-test"], stdout=log, stderr=subprocess.STDOUT, timeout=120)
            if testing.returncode != 0:
                raise ValueError("Native companion self-tests failed; inspect the private log")
            result = subprocess.run(
                [
                    *command,
                    str(staging / "source/world"),
                    str(staging / "companion-data-1.21.7"),
                    str(staging / "native-chunks-26.2"),
                    str(output),
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=1200,
            )
            log.flush()
            os.fsync(log.fileno())
        if result.returncode != 0:
            raise ValueError("Native companion conversion failed; inspect the private log")
        converted = json.loads((output / "conversion-receipt.json").read_text(encoding="utf-8"))
        if (
            converted["dataVersion"] != 4903
            or converted["positionValidation"] != "VERIFIED"
            or converted["terrainGeneration"]
            or converted["worldTicks"]
        ):
            raise ValueError("Native companion conversion violated its offline contract")
        for directory in ("playerdata", "stats", "data"):
            before = {path.name for path in (staging / "companion-data-1.21.7" / directory).iterdir()}
            after = {path.name for path in (output / directory).iterdir()}
            if before != after or (directory != "data" and len(after) != EXPECTED_PLAYERS):
                raise ValueError("Native companion conversion changed identities or map inventory")
        for root, expected in manifests.items():
            if fingerprint(staging / root) != expected:
                raise ValueError("Native companion conversion changed a verified input")
        if {path.name: digest(path) for path in sources} != source_hashes:
            raise ValueError("Native companion tool changed during conversion")
        save_json(staging / "native-companion-data-26.2-files.json", fingerprint(output))
        receipt.update(
            phase="NATIVE_COMPANION_DATA_CONVERTED",
            playerConversion="PAPER_262_VERIFIED",
            nativeCompanionReceiptSha256=digest(output / "conversion-receipt.json"),
        )
    except BaseException:
        receipt["phase"] = "NATIVE_COMPANION_CONVERSION_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def convert_native_auxiliary(staging: Path, paper: Path, bootstrap: Path) -> None:
    staging, paper, bootstrap = (path.resolve(strict=True) for path in (staging, paper, bootstrap))
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "NATIVE_COMPANION_DATA_CONVERTED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Auxiliary conversion requires the verified native companion checkpoint")
    classpath = conversion_classpath(bootstrap, paper, "26.2")
    source = Path(__file__).resolve().parent / "conversion/NativeAuxiliaryConverter.java"
    source_hash = digest(source)
    world = staging / "conversion-1.21.7/world"
    inventories = {name: chunk_inventory(world / name) for name in ("entities", "poi")}
    manifests = {name: fingerprint(world / name) for name in inventories}
    output = staging / "native-auxiliary-26.2"
    if output.exists():
        raise ValueError("Auxiliary output already exists; retain and inspect its receipt")
    receipt.update(phase="NATIVE_AUXILIARY_CONVERTING", nativeAuxiliaryToolSha256=source_hash)
    save_json(staging / JOURNAL, receipt)
    try:
        with (staging / "native-auxiliary-conversion.log").open("x", encoding="utf-8") as log:
            result = subprocess.run(
                ["java", "-Xmx2G", "--class-path", classpath, str(source), str(world), str(output)],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=120,
            )
            log.flush()
            os.fsync(log.fileno())
        if result.returncode != 0:
            raise ValueError("Auxiliary conversion failed; inspect the private log")
        converted = json.loads((output / "conversion-receipt.json").read_text(encoding="utf-8"))
        if converted["dataVersion"] != 4903 or converted["terrainGeneration"] or converted["worldTicks"]:
            raise ValueError("Auxiliary conversion violated its offline contract")
        for name, before in inventories.items():
            after = chunk_inventory(output / name)
            if before.keys() != after.keys() or set(converted["storage"][name]) != set(before):
                raise ValueError("Auxiliary conversion changed the entity/POI footprint")
            if fingerprint(world / name) != manifests[name]:
                raise ValueError("Auxiliary conversion changed a legacy checkpoint")
        if digest(source) != source_hash:
            raise ValueError("Auxiliary converter changed during conversion")
        save_json(staging / "native-auxiliary-26.2-files.json", fingerprint(output))
        receipt.update(
            phase="NATIVE_ARCHIVE_DATA_CONVERTED",
            nativeAuxiliaryReceiptSha256=digest(output / "conversion-receipt.json"),
        )
    except BaseException:
        receipt["phase"] = "NATIVE_AUXILIARY_CONVERSION_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def rehearse_native_layout(staging: Path, paper: Path, bootstrap: Path, guard: Path) -> None:
    staging, paper, bootstrap, guard = (path.resolve(strict=True) for path in (staging, paper, bootstrap, guard))
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "NATIVE_ARCHIVE_DATA_CONVERTED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Layout rehearsal requires every verified native archive checkpoint")
    classpath = conversion_classpath(bootstrap, paper, "26.2")
    if digest(guard) != receipt["guardSha256"]:
        raise ValueError("Layout rehearsal requires the same verified conversion guard")
    sources = [
        Path(__file__).resolve().parent / "conversion" / name
        for name in ("NativeLayoutMetadata.java", "NativeTerrain.java")
    ]
    source_hashes = {path.name: digest(path) for path in sources}
    roots = ("native-chunks-26.2", "native-companion-data-26.2", "native-auxiliary-26.2")
    manifests = {root: json.loads((staging / (root + "-files.json")).read_text(encoding="utf-8")) for root in roots}
    for root, expected in manifests.items():
        if fingerprint(staging / root) != expected:
            raise ValueError("A verified layout rehearsal input changed")
    required = sum(path.stat().st_size for root in roots for path in (staging / root).rglob("*") if path.is_file()) * 3
    if shutil.disk_usage(staging).free < required:
        raise ValueError("Insufficient capacity for native layout copy and Paper's migration backup")
    root = staging / "native-layout-rehearsal"
    if root.exists():
        raise ValueError("Layout rehearsal already exists; retain and inspect its evidence")
    root.mkdir(mode=0o700)
    receipt.update(phase="NATIVE_LAYOUT_REHEARSING", nativeLayoutToolSha256=source_hashes)
    save_json(staging / JOURNAL, receipt)
    try:
        world = root / "world"
        world.mkdir()
        shutil.copytree(
            staging / "native-chunks-26.2", world / "region", ignore=shutil.ignore_patterns("conversion-receipt.json")
        )
        for name in ("playerdata", "stats", "data"):
            shutil.copytree(staging / "native-companion-data-26.2" / name, world / name)
        for name in ("entities", "poi"):
            shutil.copytree(staging / "native-auxiliary-26.2" / name, world / name)
        legacy = staging / "conversion-1.21.7/world"
        shutil.copy2(legacy / "uid.dat", world / "uid.dat")
        for name in ("libraries", "versions"):
            shutil.copytree(bootstrap / name, root / name)
        with (staging / "native-layout-metadata.log").open("x", encoding="utf-8") as log:
            command = ["java", "-Xmx2G", "--class-path", classpath, str(sources[0])]
            prepared = subprocess.run(
                [*command, "prepare", str(legacy / "level.dat"), str(world / "level.dat")],
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=120,
            )
            if prepared.returncode != 0:
                raise ValueError("Legacy spawn metadata preparation failed; inspect the private log")
            conversion_configuration(root, guard)
            run_converter(root, paper, staging / "native-layout-rehearsal.log", force_upgrade=False)
            metadata_path = staging / "native-layout-metadata-receipt.json"
            verified = subprocess.run(
                [*command, "verify", str(world), str(metadata_path)], stdout=log, stderr=subprocess.STDOUT, timeout=120
            )
            log.flush()
            os.fsync(log.fileno())
        if verified.returncode != 0:
            raise ValueError("Native layout metadata verification failed; inspect the private log")
        native = world / "dimensions/minecraft/overworld"
        if (
            chunk_inventory(native / "region").keys()
            != json.loads((staging / "source-chunks.json").read_text(encoding="utf-8")).keys()
        ):
            raise ValueError("Native layout rehearsal changed the complete historic chunk footprint")
        if fingerprint(native / "region") != {
            name: checksum
            for name, checksum in manifests["native-chunks-26.2"].items()
            if name != "conversion-receipt.json"
        }:
            raise ValueError("Frozen native layout rehearsal changed terrain region files")
        for before, after in (("playerdata", "players/data"), ("stats", "players/stats")):
            expected = fingerprint(staging / "native-companion-data-26.2" / before)
            actual = fingerprint(world / after)
            if any(actual.get(name) != checksum for name, checksum in expected.items()):
                raise ValueError("Native layout rehearsal changed converted players, statistics or maps")
        maps = fingerprint(world / "data/minecraft/maps")
        expected_maps = fingerprint(staging / "native-companion-data-26.2/data")
        for name, checksum in expected_maps.items():
            target = "last_id.dat" if name == "idcounts.dat" else name.removeprefix("map_")
            if maps.get(target) != checksum:
                raise ValueError("Native layout rehearsal changed a historic map or its allocation counter")
        identity = json.loads(metadata_path.read_text(encoding="utf-8"))["worldUuid"]
        if identity != str(uuid.UUID(bytes=(legacy / "uid.dat").read_bytes())):
            raise ValueError("Native layout rehearsal changed the historic overworld identity")
        for checkpoint, expected in manifests.items():
            if fingerprint(staging / checkpoint) != expected:
                raise ValueError("Layout rehearsal changed a verified input")
        if {path.name: digest(path) for path in sources} != source_hashes:
            raise ValueError("Layout rehearsal tools changed while running")
        save_json(staging / "native-layout-rehearsal-files.json", fingerprint(world))
        receipt.update(phase="NATIVE_LAYOUT_REHEARSED", nativeLayoutReceiptSha256=digest(metadata_path))
    except BaseException:
        receipt["phase"] = "NATIVE_LAYOUT_REHEARSAL_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def preserve_heritage(staging: Path, paper: Path, bootstrap: Path, candidate: Path) -> None:
    """Keep height-upgrade generation out of the whole protected footprint, on a private copy."""
    staging, paper, bootstrap, candidate = (
        path.resolve(strict=True) for path in (staging, paper, bootstrap, candidate)
    )
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "NATIVE_LAYOUT_REHEARSED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Heritage preservation requires the verified full native layout rehearsal")
    source = staging / "native-layout-rehearsal"
    expected = json.loads((staging / "native-layout-rehearsal-files.json").read_text(encoding="utf-8"))
    if fingerprint(source / "world") != expected:
        raise ValueError("The verified native layout changed before heritage preservation")
    owned = Path(__file__).resolve().parent
    catalog = owned / "owned/plugins/TheStorm/heritage.yml"
    tool = owned / "conversion/NativePreservationCheckpoint.java"
    inputs = {"converter": digest(tool), "catalog": digest(catalog), "candidate": digest(candidate)}
    classpath = conversion_classpath(bootstrap, paper, "26.2") + os.pathsep + str(candidate)
    root = staging / "heritage-preserved-layout"
    if root.exists():
        raise ValueError("Heritage preservation already exists; retain and inspect the checkpoint")
    required = sum(path.stat().st_size for path in (source / "world").rglob("*") if path.is_file()) * 2
    if shutil.disk_usage(staging).free < required:
        raise ValueError("Insufficient capacity for an independent heritage preservation copy")
    root.mkdir(mode=0o700)
    receipt.update(phase="NATIVE_HERITAGE_PRESERVING", preservationInputs=inputs)
    save_json(staging / JOURNAL, receipt)
    try:
        with ExitStack() as locks:
            stopped_locks(source, locks)
            shutil.copytree(source / "world", root / "world")
            stopped_locks(root, locks)
            result = staging / "heritage-preservation-receipt.json"
            with (staging / "heritage-preservation.log").open("x", encoding="utf-8") as log:
                converted = subprocess.run(
                    [
                        "java",
                        "-Xmx2G",
                        "--class-path",
                        classpath,
                        str(tool),
                        str(source / "world/dimensions/minecraft/overworld/region"),
                        str(root / "world/dimensions/minecraft/overworld/region"),
                        str(catalog),
                        str(result),
                    ],
                    cwd=root,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=1200,
                )
                log.flush()
                os.fsync(log.fileno())
            if converted.returncode != 0:
                raise ValueError("Heritage preservation failed; inspect the private checkpoint log")
            proof = json.loads(result.read_text(encoding="utf-8"))
            if (
                proof["chunks"] != 638647
                or proof["protectedChunks"] != 14619
                or proof["terrainChanged"] is not False
                or proof["worldTicks"] != 0
            ):
                raise ValueError("Heritage preservation did not verify the reviewed footprint")
            original_chunks = json.loads((staging / "source-chunks.json").read_text(encoding="utf-8"))
            if chunk_inventory(root / "world/dimensions/minecraft/overworld/region").keys() != original_chunks.keys():
                raise ValueError("Heritage preservation changed the original chunk inventory")
            actual = fingerprint(root / "world")
            for name, checksum in expected.items():
                if not name.startswith("dimensions/minecraft/overworld/region/") and actual.get(name) != checksum:
                    raise ValueError("Heritage preservation changed non-terrain archive data")
            if fingerprint(source / "world") != expected:
                raise ValueError("Heritage preservation changed its verified input")
            if inputs != {"converter": digest(tool), "catalog": digest(catalog), "candidate": digest(candidate)}:
                raise ValueError("Heritage preservation inputs changed while running")
            save_json(staging / "heritage-preserved-layout-files.json", actual)
            receipt.update(phase="NATIVE_HERITAGE_PRESERVED", preservationReceiptSha256=digest(result))
    except BaseException:
        receipt["phase"] = "NATIVE_HERITAGE_PRESERVATION_FAILED"
        save_json(staging / JOURNAL, receipt)
        raise
    save_json(staging / JOURNAL, receipt)


def verified_backup(data: Path, proof: Path) -> dict[str, str]:
    """Read back the independently restored whole data volume before using modern state."""
    if data.is_symlink() or proof.is_symlink():
        raise ValueError("Backup inputs cannot be symlinks")
    receipt = json.loads(proof.read_text(encoding="utf-8"))
    if receipt.get("schemaVersion") == 2:
        expected = backup_contract.verified_export(receipt)
    elif (
        receipt.get("schemaVersion") != 1
        or receipt.get("status") != "VERIFIED"
        or not isinstance(receipt.get("files"), dict)
        or not receipt["files"]
    ):
        raise ValueError("Expected a verified independent whole-volume restore receipt")
    else:
        expected = receipt["files"]
    required = {"world/level.dat", "plugins/TheStorm/the-storm.db"}
    if not required.issubset(expected):
        raise ValueError("Backup receipt does not cover the whole Storm data volume")
    if fingerprint(data) != expected:
        raise ValueError("The independently restored backup changed after verification")
    return expected


def transplant_arenas(
    staging: Path, paper: Path, bootstrap: Path, candidate: Path, modern_data: Path, backup_proof: Path
) -> None:
    """Merge the current physical arenas into an independent, verified historical world copy."""
    for path in (staging, modern_data, backup_proof, candidate):
        if path.is_symlink():
            raise ValueError("Arena transplant inputs cannot be symlinks")
    staging, paper, bootstrap, candidate, modern_data, backup_proof = (
        path.resolve(strict=True) for path in (staging, paper, bootstrap, candidate, modern_data, backup_proof)
    )
    if staging.is_relative_to(modern_data) or modern_data.is_relative_to(staging):
        raise ValueError("Arena transplant requires independent staging and restored backup trees")
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "NATIVE_HERITAGE_PRESERVED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Arena transplant requires the verified heritage preservation checkpoint")
    source = staging / "heritage-preserved-layout"
    expected = json.loads((staging / "heritage-preserved-layout-files.json").read_text(encoding="utf-8"))
    owned = Path(__file__).resolve().parent
    catalog = owned / "owned/plugins/TheStorm/heritage.yml"
    sources = [
        owned / "conversion" / name
        for name in ("NativeArenaColumns.java", "NativeArenaStorage.java", "NativePalettes.java")
    ]
    if receipt["preservationInputs"]["catalog"] != digest(catalog):
        raise ValueError("Arena transplant catalog differs from the protected checkpoint")
    inputs = {path.name: digest(path) for path in [*sources, candidate, catalog, backup_proof]}
    classpath = conversion_classpath(bootstrap, paper, "26.2") + os.pathsep + str(candidate)
    root = staging / "arena-preserved-layout"
    if root.exists() or root.is_symlink():
        raise ValueError("Arena transplant already exists; retain and inspect its checkpoint")
    with ExitStack() as locks:
        stopped_locks(source, locks)
        stopped_locks(modern_data, locks)
        modern_expected = verified_backup(modern_data, backup_proof)
        if fingerprint(source / "world") != expected:
            raise ValueError("The verified heritage preservation input changed")
        required = sum(path.stat().st_size for path in (source / "world").rglob("*") if path.is_file()) * 2
        if shutil.disk_usage(staging).free < required:
            raise ValueError("Insufficient capacity for the independent arena transplant copy")
        root.mkdir(mode=0o700)
        receipt.update(phase="ARENAS_TRANSPLANTING", arenaTransplantInputs=inputs)
        save_json(staging / JOURNAL, receipt)
        try:
            shutil.copytree(source / "world", root / "world")
            stopped_locks(root, locks)
            dimension = "world/dimensions/minecraft/overworld"
            proof = staging / "arena-transplant-receipt.json"
            with (staging / "arena-transplant.log").open("x", encoding="utf-8") as log:
                completed = subprocess.run(
                    [
                        "java",
                        "-Xmx2G",
                        "--class-path",
                        classpath,
                        str(sources[0]),
                        str(modern_data / dimension),
                        str(root / dimension),
                        str(catalog),
                        str(proof),
                    ],
                    cwd=root,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=1200,
                )
                log.flush()
                os.fsync(log.fileno())
            if completed.returncode != 0:
                raise ValueError("Arena transplant failed; inspect the private checkpoint log")
            result = json.loads(proof.read_text(encoding="utf-8"))
            if (
                set(result["arenas"]) != {"settlement", "rustworks"}
                or result["columns"] != 64018
                or result["chunks"] != 258
                or result["terrainGeneration"] is not False
                or result["worldTicks"] != 0
            ):
                raise ValueError("Arena transplant did not verify the reviewed footprint")
            if (
                chunk_inventory(root / dimension / "region").keys()
                != chunk_inventory(source / dimension / "region").keys()
            ):
                raise ValueError("Arena transplant added or removed historical terrain chunks")
            actual = fingerprint(root / "world")
            prefixes = tuple("dimensions/minecraft/overworld/" + name + "/" for name in ("region", "entities", "poi"))
            if {name: value for name, value in actual.items() if not name.startswith(prefixes)} != {
                name: value for name, value in expected.items() if not name.startswith(prefixes)
            }:
                raise ValueError("Arena transplant changed data outside the overworld chunk stores")
            if fingerprint(source / "world") != expected or fingerprint(modern_data) != modern_expected:
                raise ValueError("Arena transplant changed an immutable input")
            if inputs != {path.name: digest(path) for path in [*sources, candidate, catalog, backup_proof]}:
                raise ValueError("Arena transplant inputs changed while running")
            save_json(staging / "arena-preserved-layout-files.json", actual)
            receipt.update(phase="ARENAS_PRESERVED", arenaTransplantReceiptSha256=digest(proof))
        except BaseException:
            receipt["phase"] = "ARENA_TRANSPLANT_FAILED"
            save_json(staging / JOURNAL, receipt)
            raise
        save_json(staging / JOURNAL, receipt)


def prepare_database(
    staging: Path, paper: Path, bootstrap: Path, candidate: Path, modern_data: Path, backup_proof: Path
) -> None:
    """Migrate a fresh database, retain proven identity rows, and import the seven proven mayors."""
    staging, paper, bootstrap, candidate, modern_data, backup_proof = (
        path.resolve(strict=True) for path in (staging, paper, bootstrap, candidate, modern_data, backup_proof)
    )
    if staging.is_relative_to(modern_data) or modern_data.is_relative_to(staging):
        raise ValueError("Database migration requires independent staging and backup trees")
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "ARENAS_PRESERVED" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Database preparation requires verified arena preservation")
    if receipt["arenaTransplantInputs"][backup_proof.name] != digest(backup_proof):
        raise ValueError("Database preparation must use the same verified modern backup")
    if receipt["arenaTransplantInputs"][candidate.name] != digest(candidate):
        raise ValueError("Database preparation must use the same candidate as arena preservation")
    owned = Path(__file__).resolve().parent
    catalog = owned / "owned/plugins/TheStorm/heritage.yml"
    policy = owned / "restoration-policy.json"
    tool = owned / "conversion/RestorationDatabase.java"
    retention = owned / "database-restore.py"
    spec = importlib.util.spec_from_file_location("database_restore", retention)
    if spec is None or spec.loader is None:
        raise ValueError("Database retention module is unavailable")
    database_restore = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(database_restore)
    reviewed = database_restore.reviewed_policy(policy)
    inputs = {path.name: digest(path) for path in (catalog, policy, tool, retention, candidate, backup_proof)}
    classpath = conversion_classpath(bootstrap, paper, "26.2") + os.pathsep + str(candidate)
    root = staging / "restoration-database"
    if root.exists() or root.is_symlink():
        raise ValueError("Database preparation already exists; retain and inspect its evidence")
    with ExitStack() as locks:
        stopped_locks(modern_data, locks)
        expected = verified_backup(modern_data, backup_proof)
        root.mkdir(mode=0o700)
        imported_at = datetime.now(UTC).isoformat()
        receipt.update(phase="DATABASE_PREPARING", databaseInputs=inputs, townImportedAt=imported_at)
        save_json(staging / JOURNAL, receipt)
        try:
            database = root / "the-storm.db"
            command = ["java", "--class-path", classpath, str(tool)]
            with (root / "migration.log").open("x", encoding="utf-8") as log:
                migrated = subprocess.run(
                    [*command, "schema", str(candidate), str(database), str(policy)],
                    cwd=root,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=120,
                )
                if migrated.returncode != 0:
                    raise ValueError("Candidate schema migration failed; inspect the private log")
                proof = database_restore.retain_identity(
                    modern_data / "plugins/TheStorm/the-storm.db", database, reviewed
                )
                imported = subprocess.run(
                    [*command, "towns", str(candidate), str(database), str(catalog), imported_at],
                    cwd=root,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=120,
                )
                log.flush()
                os.fsync(log.fileno())
            if imported.returncode != 0:
                raise ValueError("Historical owner import failed; inspect the private log")
            with closing(sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
                for table, count in (("towns_town", 7), ("towns_member", 7), ("towns_claim", 0)):
                    if connection.execute("SELECT COUNT(*) FROM " + table).fetchone() != (count,):
                        raise ValueError("Historical directory import has unexpected members or claims")
                for table in reviewed["resetTables"]:
                    if table not in ("towns_town", "towns_member") and connection.execute(
                        'SELECT COUNT(*) FROM "' + table + '"'
                    ).fetchone() != (0,):
                        raise ValueError("Unexpected gameplay progression in the prepared database")
                if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",) or list(
                    connection.execute("PRAGMA foreign_key_check")
                ):
                    raise ValueError("Prepared database failed integrity or foreign-key checks")
            if fingerprint(modern_data) != expected:
                raise ValueError("Database preparation changed its immutable modern backup")
            if inputs != {
                path.name: digest(path) for path in (catalog, policy, tool, retention, candidate, backup_proof)
            }:
                raise ValueError("Database preparation inputs changed while running")
            proof.update(
                townImport="VERIFIED",
                historicalTowns=7,
                historicalOwners=7,
                historicalClaims=0,
                importedAt=imported_at,
                databaseSha256=digest(database),
                inputs=inputs,
            )
            save_json(root / "receipt.json", proof)
            receipt.update(phase="IDENTITY_DATABASE_READY", databaseReceiptSha256=digest(root / "receipt.json"))
        except BaseException:
            receipt["phase"] = "DATABASE_PREPARATION_FAILED"
            save_json(staging / JOURNAL, receipt)
            raise
        save_json(staging / JOURNAL, receipt)


def repair_animal_identities(world: Path, modern_world: Path, root: Path, classpath: str) -> JsonObject:
    tools = Path(__file__).resolve().parent / "conversion"
    audit = root / "entity-identity-audit.json"
    proof = root / "animal-identity-repair.json"
    with (root / "animal-identity-repair.log").open("x", encoding="utf-8") as log:
        for tool, arguments in (
            ("NativeActivationCheck.java", ["audit", str(world), str(modern_world), str(audit)]),
            ("NativeAnimalIdentityRepair.java", ["self-test"]),
            ("NativeAnimalIdentityRepair.java", [str(world), str(audit), str(proof)]),
        ):
            result = subprocess.run(
                ["java", "-Xmx2G", "--class-path", classpath, str(tools / tool), *arguments],
                cwd=root,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=1200,
            )
            log.flush()
            os.fsync(log.fileno())
            if result.returncode:
                raise ValueError("Historical entity identities require review; inspect the private repair log")
    result = JsonObject.parse(proof.read_bytes())
    if (
        result.string("status") != "VERIFIED_ANIMAL_IDENTITIES"
        or result.integer("dataVersion") != 4903
        or result.integer("replacements") < 0
        or result.get("onlyDuplicateAnimalUuidChanged") is not True
        or result.get("terrainGeneration") is not False
        or result.integer("worldTicks") != 0
    ):
        raise ValueError("Animal identity repair violated the frozen preservation contract")
    before, after = result.strings("beforeFiles"), result.strings("afterFiles")
    if set(before) != set(after) or any(not re.fullmatch(r"r\.-?\d+\.-?\d+\.mca", name) for name in before):
        raise ValueError("Animal identity repair did not identify the exact historical region files")
    return result


def run_activation_check(world: Path, modern_world: Path, root: Path, classpath: str) -> dict[str, object]:
    tools = Path(__file__).resolve().parent / "conversion"
    with (root / "native-verification.log").open("x", encoding="utf-8") as log:
        for tool, arguments in (
            ("NativeLayoutMetadata.java", ["verify", str(world), str(root / "metadata-receipt.json")]),
            ("NativeActivationCheck.java", [str(world), str(modern_world), str(root / "native-receipt.json")]),
        ):
            result = subprocess.run(
                ["java", "-Xmx2G", "--class-path", classpath, str(tools / tool), *arguments],
                cwd=root,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=1200,
            )
            log.flush()
            os.fsync(log.fileno())
            if result.returncode:
                raise ValueError("Assembled activation data failed its native verification; inspect the private log")
    result = json.loads((root / "native-receipt.json").read_text(encoding="utf-8"))
    if (
        result.get("status") != "VERIFIED"
        or result.get("dataVersion") != 4903
        or result.get("entityUuidCollisions") != []
        or result.get("terrainGeneration") is not False
        or result.get("worldTicks") != 0
    ):
        raise ValueError("Native activation verification violated the frozen preservation contract")
    return result


def prepare_activation(
    staging: Path, paper: Path, bootstrap: Path, candidate: Path, modern_data: Path, backup_proof: Path
) -> None:
    """Assemble the verified historical world and retained native arena dimensions on private storage."""
    if any(path.is_symlink() for path in (staging, paper, bootstrap, candidate, modern_data, backup_proof)):
        raise ValueError("Activation preparation inputs cannot be symlinks")
    staging, paper, bootstrap, candidate, modern_data, backup_proof = (
        path.resolve(strict=True) for path in (staging, paper, bootstrap, candidate, modern_data, backup_proof)
    )
    if staging.is_relative_to(modern_data) or modern_data.is_relative_to(staging):
        raise ValueError("Activation preparation requires independent staging and backup trees")
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if receipt["phase"] != "IDENTITY_DATABASE_READY" or receipt["archiveSha256"] != ARCHIVE_SHA256:
        raise ValueError("Activation preparation requires verified arena and identity database checkpoints")
    for name, path in ((candidate.name, candidate), (backup_proof.name, backup_proof)):
        if any(receipt[key][name] != digest(path) for key in ("arenaTransplantInputs", "databaseInputs")):
            raise ValueError("Activation must use the same candidate and independently verified modern backup")
    database_root = staging / "restoration-database"
    database_receipt = database_root / "receipt.json"
    database = database_root / "the-storm.db"
    if digest(database_receipt) != receipt["databaseReceiptSha256"]:
        raise ValueError("Prepared identity database receipt changed")
    database_facts = json.loads(database_receipt.read_text(encoding="utf-8"))
    if database_facts.get("databaseSha256") != digest(database) or database_facts.get("townImport") != "VERIFIED":
        raise ValueError("Prepared identity database changed or lacks its verified historical import")
    source = staging / "arena-preserved-layout"
    expected = json.loads((staging / "arena-preserved-layout-files.json").read_text(encoding="utf-8"))
    owned = Path(__file__).resolve().parent
    tools = [
        owned / "conversion" / name
        for name in ("NativeActivationCheck.java", "NativeAnimalIdentityRepair.java", "NativeLayoutMetadata.java")
    ]
    inputs = {path.name: digest(path) for path in (*tools, candidate, backup_proof, database_receipt)}
    classpath = conversion_classpath(bootstrap, paper, "26.2")
    root = staging / "activation-layout"
    if root.exists() or root.is_symlink():
        raise ValueError("Activation layout already exists; retain and inspect its receipts")
    with ExitStack() as locks:
        stopped_locks(source, locks)
        stopped_locks(modern_data, locks)
        modern_expected = verified_backup(modern_data, backup_proof)
        if fingerprint(source / "world") != expected:
            raise ValueError("Verified arena preservation checkpoint changed")
        retained = {}
        for name in ("settlement", "rustworks", "rwf"):
            directory = modern_data / "world/dimensions/minecraft" / name
            if directory.is_symlink() or not (directory / "data/paper/metadata.dat").is_file():
                raise ValueError("Modern backup lacks a required retained arena dimension: " + name)
            retained[name] = fingerprint(directory)
            if not any(file.startswith("region/") for file in retained[name]):
                raise ValueError("Retained arena dimension has no saved terrain: " + name)
        required = sum(path.stat().st_size for path in (source / "world").rglob("*") if path.is_file())
        required += sum(
            (modern_data / "world/dimensions/minecraft" / name / file).stat().st_size
            for name, files in retained.items()
            for file in files
        )
        if shutil.disk_usage(staging).free < required * 2:
            raise ValueError("Insufficient capacity for independent activation preparation")
        root.mkdir(mode=0o700)
        receipt.update(phase="ACTIVATION_PREPARING", activationInputs=inputs)
        save_json(staging / JOURNAL, receipt)
        try:
            shutil.copytree(source / "world", root / "world")
            for name in retained:
                shutil.copytree(
                    modern_data / "world/dimensions/minecraft" / name, root / "world/dimensions/minecraft" / name
                )
            (root / "plugins/TheStorm").mkdir(parents=True, mode=0o700)
            shutil.copy2(database, root / "plugins/TheStorm/the-storm.db")
            stopped_locks(root, locks)
            animal_identities = repair_animal_identities(root / "world", modern_data / "world", root, classpath)
            repaired_expected = dict(expected)
            for name, previous in animal_identities.strings("beforeFiles").items():
                relative = "dimensions/minecraft/overworld/region/" + name
                if expected.get(relative) != previous:
                    raise ValueError("Animal identity repair does not match the immutable historical checkpoint")
                repaired_expected[relative] = animal_identities.strings("afterFiles")[name]
            native = run_activation_check(root / "world", modern_data / "world", root, classpath)
            actual = fingerprint(root / "world")
            prefixes = tuple("dimensions/minecraft/" + name + "/" for name in retained)
            if {name: value for name, value in actual.items() if not name.startswith(prefixes)} != repaired_expected:
                raise ValueError("Activation assembly changed the historical world or transplanted arena data")
            for name, files in retained.items():
                if fingerprint(root / "world/dimensions/minecraft" / name) != files:
                    raise ValueError("Retained arena dimension changed during assembly")
            if any(
                name.startswith("dimensions/minecraft/" + fresh + "/")
                for name in actual
                for fresh in ("wilds", "peaks", "mining")
            ):
                raise ValueError("Activation retained a resource world scheduled to start fresh")
            if (
                fingerprint(source / "world") != expected
                or fingerprint(modern_data) != modern_expected
                or digest(database) != database_facts["databaseSha256"]
                or inputs != {path.name: digest(path) for path in (*tools, candidate, backup_proof, database_receipt)}
            ):
                raise ValueError("Activation preparation changed an immutable input")
            files = fingerprint(root)
            save_json(staging / "activation-layout-files.json", files)
            proof = staging / "activation-layout-receipt.json"
            save_json(
                proof,
                {
                    "schemaVersion": 1,
                    "status": "VERIFIED",
                    "archiveSha256": ARCHIVE_SHA256,
                    "requestId": receipt["requestId"],
                    "candidateJarSha256": digest(candidate),
                    "backupProofSha256": digest(backup_proof),
                    "databaseSha256": database_facts["databaseSha256"],
                    "historicalChunks": EXPECTED_CHUNKS,
                    "retainedDimensions": retained,
                    "freshDimensions": ["wilds", "peaks", "mining"],
                    "native": native,
                    "animalIdentityRepair": animal_identities,
                    "inputs": inputs,
                    "filesSha256": digest(staging / "activation-layout-files.json"),
                },
            )
            receipt.update(phase="ACTIVATION_LAYOUT_READY", activationReceiptSha256=digest(proof))
        except BaseException:
            receipt["phase"] = "ACTIVATION_PREPARATION_FAILED"
            save_json(staging / JOURNAL, receipt)
            raise
        save_json(staging / JOURNAL, receipt)


def restart_companions(staging: Path) -> None:
    """Retain a failed or superseded private rehearsal and regenerate from the untouched archive."""
    staging = staging.resolve(strict=True)
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if (
        receipt["phase"]
        not in (
            "NATIVE_LAYOUT_REHEARSAL_FAILED",
            "NATIVE_COMPANION_CONVERSION_FAILED",
            "NATIVE_AUXILIARY_CONVERSION_FAILED",
            "NATIVE_LAYOUT_REHEARSED",
        )
        or receipt["archiveSha256"] != ARCHIVE_SHA256
    ):
        raise ValueError("Companion restart requires a failed native companion or layout checkpoint")
    if receipt["phase"] == "NATIVE_LAYOUT_REHEARSED":
        converter = Path(__file__).resolve().parent / "conversion"
        current = {name: digest(converter / name) for name in receipt["nativeCompanionToolSha256"]}
        if current == receipt["nativeCompanionToolSha256"]:
            raise ValueError("Successful checkpoint restart requires a changed companion converter")
    expected = json.loads((staging / "source-files.json").read_text(encoding="utf-8"))
    if fingerprint(staging / "source") != expected:
        raise ValueError("Original archive source changed; companion restart is forbidden")
    expected_chunks = json.loads((staging / "native-chunks-26.2-files.json").read_text(encoding="utf-8"))
    if fingerprint(staging / "native-chunks-26.2") != expected_chunks:
        raise ValueError("Verified native terrain changed; companion restart is forbidden")
    names = [
        "companion-data-1.21.7",
        "companion-data-1.21.7-files.json",
        "companion-conversion-1.21.7.log",
        "native-companion-data-26.2",
        "native-companion-data-26.2-files.json",
        "native-companion-conversion.log",
        "native-auxiliary-26.2",
        "native-auxiliary-26.2-files.json",
        "native-auxiliary-conversion.log",
        "native-layout-rehearsal",
        "native-layout-rehearsal.log",
        "native-layout-metadata.log",
        "native-layout-metadata-receipt.json",
        "native-layout-rehearsal-files.json",
    ]
    for name in names:
        if (staging / name).is_symlink():
            raise ValueError("A restart checkpoint is a symlink")
    with ExitStack() as locks:
        if (staging / "native-layout-rehearsal").exists():
            stopped_locks(staging / "native-layout-rehearsal", locks)
        epoch = staging / "superseded" / str(uuid.uuid4())
        epoch.mkdir(mode=0o700, parents=True)
        save_json(epoch / "prior-journal.json", receipt)
        receipt.update(phase="COMPANION_CHECKPOINT_RESTARTING", restartArchive=str(epoch.relative_to(staging)))
        save_json(staging / JOURNAL, receipt)
        for name in names:
            path = staging / name
            if path.exists():
                path.rename(epoch / name)
        receipt["supersededAttempts"] = [*receipt.get("supersededAttempts", []), str(epoch.relative_to(staging))]
        for key in (
            "companionReceiptSha256",
            "companionToolSha256",
            "nativeCompanionReceiptSha256",
            "nativeCompanionToolSha256",
            "nativeAuxiliaryReceiptSha256",
            "nativeAuxiliaryToolSha256",
            "nativeLayoutReceiptSha256",
            "nativeLayoutToolSha256",
            "restartArchive",
        ):
            receipt.pop(key, None)
        receipt.update(phase="LEGACY_CHUNKS_CONVERTED", playerConversion="PENDING")
        save_json(staging / JOURNAL, receipt)


def reuse_native_chunks(staging: Path) -> None:
    staging = staging.resolve(strict=True)
    receipt = json.loads((staging / JOURNAL).read_text(encoding="utf-8"))
    if (
        receipt["phase"] != "COMPANION_DATA_CONVERTED"
        or receipt["archiveSha256"] != ARCHIVE_SHA256
        or not receipt.get("supersededAttempts")
    ):
        raise ValueError("Native chunk reuse requires a verified companion restart")
    expected = json.loads((staging / "native-chunks-26.2-files.json").read_text(encoding="utf-8"))
    output = staging / "native-chunks-26.2"
    source = Path(__file__).resolve().parent / "conversion/NativeChunkConverter.java"
    if (
        fingerprint(output) != expected
        or digest(source) != receipt["nativeChunkToolSha256"]
        or digest(output / "conversion-receipt.json") != receipt["nativeChunkReceiptSha256"]
    ):
        raise ValueError("Previously verified native chunks or their converter changed")
    if chunk_inventory(output).keys() != json.loads((staging / "source-chunks.json").read_text()).keys():
        raise ValueError("Previously verified native chunk footprint changed")
    receipt["phase"] = "NATIVE_CHUNKS_CONVERTED"
    save_json(staging / JOURNAL, receipt)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def save_json(path: Path, value: object) -> None:
    """A durable receipt is atomically replaced only after its contents reach storage."""
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def fingerprint(root: Path) -> dict[str, str]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Expected an existing directory without a symlink")
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symlink in backup: {path.relative_to(root)}")
        if path.is_file() and path.name != "session.lock":
            result[str(path.relative_to(root))] = digest(path)
    return result


def stopped_locks(root: Path, stack: ExitStack) -> None:
    """Includes native Paper dimension locks and player/global storage, not just top-level worlds."""
    if root.is_symlink() or not (root / "world/level.dat").is_file():
        raise ValueError("Expected a Minecraft data directory with world/level.dat")
    for path in root.rglob("session.lock"):
        if path.is_symlink():
            raise ValueError("World session lock is a symlink")
        handle = stack.enter_context(path.open("r+b"))
        try:
            fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("A world is running; stop every PVC writer first") from error


def archive_members(archive: zipfile.ZipFile) -> list[tuple[zipfile.ZipInfo, PurePosixPath]]:
    result = []
    seen = set()
    for entry in archive.infolist():
        path = PurePosixPath(entry.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
            raise ValueError("Unsafe archive path")
        if stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError("Archive contains a symlink")
        if entry.is_dir():
            continue
        if not entry.filename.startswith(ARCHIVE_ROOT):
            raise ValueError("Archive contains files outside the selected world")
        relative = PurePosixPath(entry.filename[len(ARCHIVE_ROOT) :])
        if not relative.parts or relative in seen:
            raise ValueError("Empty or duplicate archive member")
        seen.add(relative)
        result.append((entry, relative))
    return result


def chunk_inventory(region: Path) -> dict[str, int]:
    """Validate Anvil allocation headers without loading or regenerating a single chunk."""
    result = {}
    for path in sorted(region.glob("r.*.*.mca")):
        parts = path.name.split(".")
        if len(parts) != 4:
            raise ValueError("Malformed region filename")
        rx, rz = int(parts[1]), int(parts[2])
        size = path.stat().st_size
        with path.open("rb") as source:
            header = source.read(8192)
            if len(header) != 8192:
                raise ValueError(f"Truncated region: {path.name}")
            occupied = set()
            for index in range(1024):
                location = struct.unpack_from(">I", header, index * 4)[0]
                if location == 0:
                    continue
                sector, count = location >> 8, location & 255
                if sector < 2 or count == 0 or (sector + count) * 4096 > size:
                    raise ValueError(f"Invalid chunk allocation: {path.name}:{index}")
                allocation = set(range(sector, sector + count))
                if occupied.intersection(allocation):
                    raise ValueError(f"Overlapping chunk allocation: {path.name}:{index}")
                occupied.update(allocation)
                source.seek(sector * 4096)
                length = struct.unpack(">I", source.read(4))[0]
                compression = source.read(1)
                if length < 1 or length + 4 > count * 4096 or compression not in (b"\x01", b"\x02", b"\x03"):
                    raise ValueError(f"Unsupported or truncated chunk: {path.name}:{index}")
                result[f"{rx * 32 + index % 32},{rz * 32 + index // 32}"] = length
    return result


def prepare(archive_path: Path, staging: Path) -> None:
    archive_path = archive_path.resolve(strict=True)
    staging = staging.absolute()
    if staging.exists() or archive_path.is_relative_to(staging):
        raise ValueError("Use a new, isolated staging directory")
    if digest(archive_path) != ARCHIVE_SHA256:
        raise ValueError("Archive is not the approved July 2015 source")
    with zipfile.ZipFile(archive_path) as archive:
        members = archive_members(archive)
        if archive.testzip() is not None:
            raise ValueError("Archive CRC verification failed")
        required_bytes = sum(entry.file_size for entry, _ in members) * 3
        parent = staging.parent.resolve(strict=True)
        if shutil.disk_usage(parent).free < required_bytes:
            raise ValueError("Insufficient staging capacity for source, conversion copy and checkpoint")
        staging.mkdir(mode=0o700)
        receipt = {
            "schemaVersion": 1,
            "requestId": str(uuid.uuid4()),
            "phase": "EXTRACTING",
            "archiveSha256": ARCHIVE_SHA256,
            "chunkTrimming": False,
        }
        save_json(staging / JOURNAL, receipt)
        world = staging / "source/world"
        world.mkdir(parents=True)
        for entry, relative in members:
            target = world.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
        chunks = chunk_inventory(world / "region")
        players = sorted(path.stem for path in (world / "playerdata").glob("*.dat"))
        if len(chunks) != EXPECTED_CHUNKS or len(players) != EXPECTED_PLAYERS:
            raise ValueError("Archive chunk/player inventory disagrees with reviewed source")
        save_json(staging / "source-chunks.json", chunks)
        save_json(staging / "source-files.json", fingerprint(staging / "source"))
        # Future converters operate only on copies. The extracted source and ZIP stay unchanged.
        shutil.copytree(world, staging / "conversion-1.21.7/world")
        receipt.update(
            phase="PREPARED",
            chunks=len(chunks),
            players=len(players),
            sourceInventorySha256=digest(staging / "source-files.json"),
        )
        save_json(staging / JOURNAL, receipt)


def verify_copy(original: Path, restored: Path, output: Path) -> None:
    if any(path.is_symlink() for path in (original, restored, output)):
        raise ValueError("Backup verification inputs and receipt cannot be symlinks")
    original, restored = original.resolve(strict=True), restored.resolve(strict=True)
    if original == restored or original.is_relative_to(restored) or restored.is_relative_to(original):
        raise ValueError("Backup verification requires independent, non-overlapping directories")
    if output.exists() or output.resolve().is_relative_to(original) or output.resolve().is_relative_to(restored):
        raise ValueError("Receipt must be new and outside both backup trees")
    with ExitStack() as locks:
        stopped_locks(original, locks)
        stopped_locks(restored, locks)
        before, after = fingerprint(original), fingerprint(restored)
        if before != after:
            changed = sorted(
                set(before).symmetric_difference(after)
                | {name for name in before.keys() & after.keys() if before[name] != after[name]}
            )
            raise ValueError(f"Restored copy differs in {len(changed)} files")
        if any((original / name).samefile(restored / name) for name in before):
            raise ValueError("Independent backup restore cannot share hard-linked files with its source")
        save_json(output, {"schemaVersion": 1, "status": "VERIFIED", "files": before})


def database_inventory(database: Path, output: Path) -> None:
    """Emit schema and row counts only. Item payloads and private moderation contents stay private."""
    if output.exists():
        raise ValueError("Inventory receipt already exists")
    with closing(sqlite3.connect(f"{database.resolve(strict=True).as_uri()}?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("Storm database integrity check failed")
        tables = {}
        for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            quoted = '"' + name.replace('"', '""') + '"'
            tables[name] = {
                "rows": connection.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0],
                "columns": [row[1] for row in connection.execute(f"PRAGMA table_info({quoted})")],
            }
        save_json(output, {"schemaVersion": 1, "tables": tables})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    preparing = commands.add_parser("prepare")
    preparing.add_argument("--archive", required=True, type=Path)
    preparing.add_argument("--staging", required=True, type=Path)
    converting = commands.add_parser("convert-legacy")
    converting.add_argument("--staging", required=True, type=Path)
    converting.add_argument("--paper", required=True, type=Path)
    converting.add_argument("--guard", required=True, type=Path)
    companions = commands.add_parser("convert-companions")
    companions.add_argument("--staging", required=True, type=Path)
    companions.add_argument("--paper", required=True, type=Path)
    native = commands.add_parser("convert-native-chunks")
    native.add_argument("--staging", required=True, type=Path)
    native.add_argument("--paper", required=True, type=Path)
    native.add_argument("--bootstrap", required=True, type=Path)
    native_companions = commands.add_parser("convert-native-companions")
    native_companions.add_argument("--staging", required=True, type=Path)
    native_companions.add_argument("--paper", required=True, type=Path)
    native_companions.add_argument("--bootstrap", required=True, type=Path)
    auxiliary = commands.add_parser("convert-native-auxiliary")
    auxiliary.add_argument("--staging", required=True, type=Path)
    auxiliary.add_argument("--paper", required=True, type=Path)
    auxiliary.add_argument("--bootstrap", required=True, type=Path)
    layout = commands.add_parser("rehearse-native-layout")
    layout.add_argument("--staging", required=True, type=Path)
    layout.add_argument("--paper", required=True, type=Path)
    layout.add_argument("--bootstrap", required=True, type=Path)
    layout.add_argument("--guard", required=True, type=Path)
    preserving = commands.add_parser("preserve-heritage")
    preserving.add_argument("--staging", required=True, type=Path)
    preserving.add_argument("--paper", required=True, type=Path)
    preserving.add_argument("--bootstrap", required=True, type=Path)
    preserving.add_argument("--candidate", required=True, type=Path)
    arenas = commands.add_parser("transplant-arenas")
    for name in ("staging", "paper", "bootstrap", "candidate", "modern-data", "backup-proof"):
        arenas.add_argument("--" + name, required=True, type=Path)
    database = commands.add_parser("prepare-database")
    for name in ("staging", "paper", "bootstrap", "candidate", "modern-data", "backup-proof"):
        database.add_argument("--" + name, required=True, type=Path)
    activation = commands.add_parser("prepare-activation")
    for name in ("staging", "paper", "bootstrap", "candidate", "modern-data", "backup-proof"):
        activation.add_argument("--" + name, required=True, type=Path)
    restarting = commands.add_parser("restart-companions")
    restarting.add_argument("--staging", required=True, type=Path)
    reusing = commands.add_parser("reuse-native-chunks")
    reusing.add_argument("--staging", required=True, type=Path)
    verifying = commands.add_parser("verify-copy")
    verifying.add_argument("--original", required=True, type=Path)
    verifying.add_argument("--restored", required=True, type=Path)
    verifying.add_argument("--output", required=True, type=Path)
    inventory = commands.add_parser("database-inventory")
    inventory.add_argument("--database", required=True, type=Path)
    inventory.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    with ExitStack() as operations:
        if arguments.command not in ("prepare", "verify-copy", "database-inventory"):
            operations.enter_context(operation_lock(arguments.staging))
        execute(arguments)


def execute(arguments: argparse.Namespace) -> None:
    if arguments.command == "prepare":
        prepare(arguments.archive, arguments.staging)
    elif arguments.command == "convert-legacy":
        convert_legacy(arguments.staging, arguments.paper, arguments.guard)
    elif arguments.command == "convert-companions":
        convert_companions(arguments.staging, arguments.paper)
    elif arguments.command == "convert-native-chunks":
        convert_native_chunks(arguments.staging, arguments.paper, arguments.bootstrap)
    elif arguments.command == "convert-native-companions":
        convert_native_companions(arguments.staging, arguments.paper, arguments.bootstrap)
    elif arguments.command == "convert-native-auxiliary":
        convert_native_auxiliary(arguments.staging, arguments.paper, arguments.bootstrap)
    elif arguments.command == "rehearse-native-layout":
        rehearse_native_layout(arguments.staging, arguments.paper, arguments.bootstrap, arguments.guard)
    elif arguments.command == "restart-companions":
        restart_companions(arguments.staging)
    elif arguments.command == "preserve-heritage":
        preserve_heritage(arguments.staging, arguments.paper, arguments.bootstrap, arguments.candidate)
    elif arguments.command == "transplant-arenas":
        transplant_arenas(
            arguments.staging,
            arguments.paper,
            arguments.bootstrap,
            arguments.candidate,
            arguments.modern_data,
            arguments.backup_proof,
        )
    elif arguments.command == "prepare-database":
        prepare_database(
            arguments.staging,
            arguments.paper,
            arguments.bootstrap,
            arguments.candidate,
            arguments.modern_data,
            arguments.backup_proof,
        )
    elif arguments.command == "prepare-activation":
        prepare_activation(
            arguments.staging,
            arguments.paper,
            arguments.bootstrap,
            arguments.candidate,
            arguments.modern_data,
            arguments.backup_proof,
        )
    elif arguments.command == "reuse-native-chunks":
        reuse_native_chunks(arguments.staging)
    elif arguments.command == "verify-copy":
        verify_copy(arguments.original, arguments.restored, arguments.output)
    elif arguments.command == "database-inventory":
        database_inventory(arguments.database, arguments.output)
    else:
        raise ValueError("Unsupported restoration operation")


if __name__ == "__main__":
    main()
