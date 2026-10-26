"""Apply a sealed one-time world retirement to an already stopped volume."""

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from maintenance import database
from maintenance import files as storage
from maintenance.values import JsonObject

MARKER = ".the-storm-retired-worlds.json"
REGISTRY = "plugins/Multiverse-Core/worlds.yml"
PREFIXES = tuple(f"world/dimensions/minecraft/{name}/" for name in ("wilds", "peaks"))
TASKS = frozenset(
    f"plugins/Chunky/tasks/{name}.properties"
    for name in ("wilds", "peaks", "frontier", "skylands", "world_nether", "world_the_end", "creative")
)


def volume_files(data: Path, request: str) -> dict[str, str]:
    prefix = f"{storage.WORKSPACE}/{request}/circular-worlds/"
    return {
        name: checksum
        for name, checksum in storage.files(data).items()
        if not name.startswith(prefix)
    }


def original_files(plan: JsonObject) -> dict[str, str]:
    if plan.get("schemaVersion") != 1:
        raise ValueError("Retirement requires a sealed offline source manifest")
    original = storage.checked_manifest(plan.strings("files"))
    if any(name == MARKER or name.startswith(f"{storage.WORKSPACE}/{plan.string('requestId')}/") for name in original):
        raise ValueError("World retirement has already been prepared or applied")
    if not {"world/level.dat", REGISTRY, storage.DATABASE}.issubset(original):
        raise ValueError("Source manifest lacks required world and identity stores")
    return original


def installation_files(value: dict[str, str]) -> dict[str, str]:
    expected = storage.checked_manifest(value)
    if not {REGISTRY, storage.DATABASE}.issubset(expected) or any(
        name not in (REGISTRY, storage.DATABASE)
        and not re.fullmatch(r"world/players/data/[a-f0-9-]{36}\.dat(?:_old)?", name)
        for name in expected
    ):
        raise ValueError("World maintenance may replace only native players, saved destinations and registry")
    return expected


def prepare(data: Path, root: Path, plan: JsonObject, original: dict[str, str], operator: Path) -> JsonObject:
    if volume_files(data, plan.string("requestId")) != original:
        raise ValueError("Stopped source differs from its sealed manifest")
    if storage.digest(Path("/plugins/TheStorm/world.yml")) != plan.string("worldConfigSha256"):
        raise ValueError("Published world borders differ from the sealed retirement policy")
    radii = database.border_radii(plan.objects("borders"))
    policy = {
        "schemaVersion": 1,
        "retired": ["wilds", "peaks"],
        "borders": plan.objects("borders"),
    }
    with tempfile.TemporaryDirectory(prefix="retirement-", dir="/scratch") as directory:
        scratch = Path(directory)
        storage.save(scratch / "policy.json", policy)
        native = scratch / "native"
        classpath = os.pathsep.join(
            [
                str(operator),
                "/opt/paper/versions/26.3/paper-26.3.jar",
                *(str(path) for path in sorted(Path("/opt/paper/libraries").rglob("*.jar"))),
            ]
        )
        subprocess.run(
            [
                "java",
                "-Xms32m",
                "-Xmx256m",
                "--class-path",
                classpath,
                "NativePlayerRetirement",
                str(data),
                str(scratch / "policy.json"),
                str(native),
            ],
            cwd=scratch,
            env={"PATH": os.environ["PATH"]},
            check=True,
            timeout=180,
        )
        receipt = JsonObject.parse((native / "receipt.json").read_bytes())
        if (
            receipt.get("inventoriesPreserved") is not True
            or receipt.get("dataVersion") != 4903
            or any(original.get(name) != checksum for name, checksum in receipt.strings("originalFiles").items())
        ):
            raise ValueError("Native player preparation differs from the verified original")
        payload = root / "payload"
        payload.mkdir(exist_ok=True)
        expected = receipt.strings("preparedFiles")
        for name, checksum in expected.items():
            source, destination = native / name, payload / name
            if storage.digest(source) != checksum:
                raise ValueError("Prepared native player or registry changed")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            storage.preserve_metadata(data / name, destination)
        db = scratch / "database.db"
        database_receipt = database.prepare(
            data / storage.DATABASE, db, plan.objects("graveSites"), plan.integer("preparedAt"), radii
        )
        destination = payload / storage.DATABASE
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(db, destination)
        storage.preserve_metadata(data / storage.DATABASE, destination)
        expected[storage.DATABASE] = storage.digest(destination)
        expected = installation_files(expected)
        if storage.files(payload) != expected or volume_files(data, plan.string("requestId")) != original:
            raise ValueError("Preparation changed source or carries unapproved payload files")
        for name in expected:
            with (payload / name).open("rb") as handle:
                os.fsync(handle.fileno())
        for directory in sorted((item for item in payload.rglob("*") if item.is_dir()), reverse=True):
            storage.sync_directory(directory)
        storage.sync_directory(payload)
        storage.sync_directory(root)
        return JsonObject(
            {"phase": "PREPARED", "plan": plan, "files": expected, "native": receipt, "database": database_receipt}
        )


def install(
    data: Path, plan: JsonObject, operator: Path, baked_jar: Path = Path("/plugins/TheStorm.jar")
) -> JsonObject:
    request = plan.string("requestId")
    if (
        str(uuid.UUID(request)) != request
        or plan.get("scope") != "circular-worlds"
        or storage.digest(baked_jar) != plan.string("candidateJarSha256")
        or storage.digest(operator / "NativePlayerRetirement.class") != plan.string("nativeClassSha256")
        or (data.stat().st_dev, data.stat().st_ino) != (plan.integer("sourceDevice"), plan.integer("sourceInode"))
        or not re.fullmatch(
            r"(?:docker\.io|ghcr\.io)/shepherdjerred/the-storm-server:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}",
            plan.string("candidateImage"),
        )
    ):
        raise ValueError("Retirement requires exact request, source, native helper and published plugin identities")
    original = original_files(plan)
    root = data / storage.WORKSPACE / request / "circular-worlds"
    for parent in (root, root.parent, root.parent.parent):
        if parent.is_symlink():
            raise ValueError("Retirement workspace cannot be linked")
    with storage.stopped(data):
        journal_path = root / "journal.json"
        if not journal_path.exists():
            if root.exists() or volume_files(data, request) != original:
                raise ValueError("Retirement source or workspace changed before staging")
            root.mkdir(parents=True, mode=0o700)
            storage.save(journal_path, {"phase": "PREPARING", "plan": plan})
        receipt = JsonObject.parse(journal_path.read_bytes())
        if receipt.object("plan") != plan:
            raise ValueError("Retirement belongs to different sealed inputs")
        if receipt.get("phase") == "PREPARING":
            receipt = prepare(data, root, plan, original, operator)
            storage.save(journal_path, receipt)
        expected = installation_files(receipt.strings("files"))
        removals = {
            name: checksum
            for name, checksum in original.items()
            if name.startswith(PREFIXES)
            or name in TASKS
            or name in (storage.DATABASE + "-wal", storage.DATABASE + "-shm")
        }
        untouched = {
            name: checksum for name, checksum in original.items() if name not in expected and name not in removals
        }
        current = volume_files(data, request)
        if {
            name: checksum
            for name, checksum in current.items()
            if name not in expected and name not in removals and name != MARKER
        } != untouched:
            raise ValueError("Unrelated terrain, archives, identities or progression changed during retirement")
        if receipt.get("phase") == "INSTALLED":
            if (
                any(current.get(name) != checksum for name, checksum in expected.items())
                or any(name in current for name in removals)
                or MARKER not in current
            ):
                raise ValueError("Completed retirement changed before acceptance")
            return receipt
        for name, checksum in expected.items():
            if (
                current.get(name) not in (original.get(name), checksum)
                or storage.digest(root / "payload" / name) != checksum
            ):
                raise ValueError("Retirement target or staged payload changed: " + name)
        if any(current.get(name) not in (None, checksum) for name, checksum in removals.items()):
            raise ValueError("Retired world changed during deletion")
        storage.save(journal_path, {**receipt, "phase": "APPLYING"})
        for name, checksum in expected.items():
            target = data / name
            if current.get(name) == checksum:
                continue
            temporary = root / ("install-" + str(uuid.uuid4()))
            shutil.copyfile(root / "payload" / name, temporary)
            storage.preserve_metadata(root / "payload" / name, temporary)
            with temporary.open("rb") as handle:
                os.fsync(handle.fileno())
            temporary.replace(target)
            storage.sync_directory(target.parent)
        for name in removals:
            target = data / name
            if target.exists():
                target.unlink()
                storage.sync_directory(target.parent)
        for prefix in PREFIXES:
            directory = data / prefix
            if directory.exists():
                for child in sorted(directory.rglob("*"), key=lambda path: len(path.parts), reverse=True):
                    if child.is_dir():
                        child.rmdir()
                    elif child.name == "session.lock" and child.is_file():
                        child.unlink()
                    else:
                        raise ValueError("Unsealed file remains in retired world")
                directory.rmdir()
                storage.sync_directory(directory.parent)
        storage.save(
            data / MARKER,
            {
                "schemaVersion": 1,
                "requestId": request,
                "retired": ["wilds", "peaks"],
                "status": "COMPLETE",
            },
        )
        final = volume_files(data, request)
        if {name: checksum for name, checksum in final.items() if name != MARKER} != {**untouched, **expected}:
            raise ValueError("Retirement readback differs from the exact intended file manifest")
        receipt.update(
            phase="INSTALLED",
            scope="circular-worlds",
            unrelatedFiles="UNCHANGED",
            candidateJarSha256=plan.string("candidateJarSha256"),
        )
        storage.save(journal_path, receipt)
        return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--operator", required=True, type=Path)
    arguments = parser.parse_args()
    receipt = install(
        arguments.data,
        JsonObject.parse(arguments.plan.read_bytes()),
        arguments.operator,
    )
    print(json.dumps({key: receipt[key] for key in ("phase", "scope", "candidateJarSha256", "unrelatedFiles")}))
