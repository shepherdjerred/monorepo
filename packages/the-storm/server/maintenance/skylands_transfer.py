"""One-shot, stopped-save Skylands export/install. Never copies production player data."""

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

from maintenance import files
from maintenance.skylands import MARKER, identity

DIMENSION = Path("world/dimensions/minecraft/skylands")


def regular_path(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError("Transfer paths cannot contain links")


def copy_checked(source: Path, destination: Path) -> None:
    regular_path(source)
    regular_path(destination)
    if source.is_dir():
        expected = files.files(source)
        shutil.copytree(source, destination, ignore=lambda _, names: [n for n in names if n == "session.lock"])
        if files.files(destination) != expected or files.files(source) != expected:
            raise ValueError("Source changed during copy or destination checksum differs")
    else:
        expected = files.digest(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if files.digest(source) != expected or files.digest(destination) != expected:
            raise ValueError("File changed during copy")
    if destination.is_dir():
        for path in destination.rglob("*"):
            if path.is_file():
                with path.open("rb") as stream:
                    os.fsync(stream.fileno())
        for directory, _, _ in os.walk(destination, topdown=False):
            files.sync_directory(Path(directory))
    else:
        with destination.open("rb") as stream:
            os.fsync(stream.fileno())
    files.sync_directory(destination.parent)


def transfer_root(data: Path, request_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", request_id):
        raise ValueError("Invalid transfer request ID")
    root = data / files.WORKSPACE / "skylands" / request_id
    regular_path(root)
    return root


def manifest_digest(manifest: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_payload(payload: Path) -> dict[str, str]:
    regular_path(payload)
    manifest = files.files(payload)
    required = {str(DIMENSION / "data/minecraft/world_gen_settings.dat"), "world/level.dat", MARKER}
    if not required.issubset(manifest):
        raise ValueError("Transfer lacks native dimension or parent save metadata")
    for name in manifest:
        if not (name == MARKER or name == "world/level.dat" or name.startswith(
            (str(DIMENSION) + "/", "world/data/", "world/datapacks/"))):
            raise ValueError("Transfer contains data outside Skylands and its parent metadata")
    if identity(payload / MARKER) != {"world": "skylands", "seed": 1731, "format": "layered-v1"}:
        raise ValueError("Unexpected Skylands generation identity")
    if not any(name.startswith(str(DIMENSION / "region") + "/") and name.endswith(".mca") for name in manifest):
        raise ValueError("Transfer contains no saved region files")
    return manifest


def export_world(data: Path, request_id: str) -> Path:
    root = transfer_root(data, request_id)
    with files.stopped(data):
        receipt = root / "export.json"
        payload = root / "payload"
        if receipt.exists():
            regular_path(receipt)
            recorded = json.loads(receipt.read_text())
            if recorded != {"schemaVersion": 1, "files": validate_payload(payload)}:
                raise ValueError("Existing export receipt does not match payload")
            return payload
        if root.exists():
            raise ValueError("Incomplete export exists; inspect it and use a new request ID")
        regular_path(data / DIMENSION)
        root.mkdir(parents=True, mode=0o700)
        (payload / DIMENSION.parent).mkdir(parents=True)
        copy_checked(data / DIMENSION, payload / DIMENSION)
        copy_checked(data / "world/level.dat", payload / "world/level.dat")
        copy_checked(data / MARKER, payload / MARKER)
        for name in ("data", "datapacks"):
            source = data / "world" / name
            regular_path(source)
            if source.exists():
                copy_checked(source, payload / "world" / name)
        manifest = validate_payload(payload)
        files.save(receipt, {"schemaVersion": 1, "files": manifest})
        return payload


def install_world(data: Path, request_id: str, expected_digest: str) -> None:
    root = transfer_root(data, request_id)
    payload = root / "payload"
    if not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
        raise ValueError("Expected a reviewed SHA256 manifest digest")
    with files.stopped(data):
        receipt = root / "install.json"
        regular_path(receipt)
        state = None
        if receipt.exists():
            state = json.loads(receipt.read_text())
            if not isinstance(state, dict) or set(state) != {"schemaVersion", "status", "digest"} or state.get("digest") != expected_digest or type(state.get("schemaVersion")) is not int or state["schemaVersion"] != 1:
                raise ValueError("Install request identity changed")
            if state["status"] == "COMPLETE":
                # Completed requests remain inert even after staging payload cleanup.
                regular_path(data / DIMENSION)
                if not (data / DIMENSION / "data/minecraft/world_gen_settings.dat").is_file():
                    raise ValueError("Installed Skylands dimension is missing; refuse regeneration")
                return
            if state["status"] != "APPLYING":
                raise ValueError("Unknown install state")
        manifest = validate_payload(payload)
        if manifest_digest(manifest) != expected_digest:
            raise ValueError("Incoming payload differs from reviewed manifest")
        if identity(data / MARKER) != identity(payload / MARKER):
            raise ValueError("Incoming and live generation identities differ")
        target = data / DIMENSION
        staged = target.with_name(".skylands-" + request_id)
        original = root / "original-dimension"
        for path in (target, staged, original, receipt):
            regular_path(path)
        expected = files.files(payload / DIMENSION)
        if state is None:
            if original.exists() or staged.exists():
                raise ValueError("Unjournaled transfer artifacts exist")
            if not target.is_dir():
                raise ValueError("Expected an existing live Skylands dimension")
            size = sum(path.stat().st_size for path in (payload / DIMENSION).rglob("*") if path.is_file())
            if shutil.disk_usage(target.parent).free < size:
                raise ValueError("Insufficient room to stage the replacement")
            copy_checked(payload / DIMENSION, staged)
            owner = target.stat()
            for path in (staged, *staged.rglob("*")):
                if (path.stat().st_uid, path.stat().st_gid) != (owner.st_uid, owner.st_gid):
                    os.chown(path, owner.st_uid, owner.st_gid)
            files.save(receipt, {"schemaVersion": 1, "status": "APPLYING", "digest": expected_digest})
        if not original.exists():
            if not staged.is_dir() or files.files(staged) != expected:
                raise ValueError("Staged dimension is missing or changed")
            target.rename(original)
            files.sync_directory(target.parent)
            files.sync_directory(root)
        if not target.exists():
            if not staged.is_dir() or files.files(staged) != expected:
                raise ValueError("Cannot resume interrupted dimension installation")
            staged.rename(target)
            files.sync_directory(target.parent)
        if files.files(target) != expected:
            raise ValueError("Installed dimension differs from reviewed payload")
        files.save(receipt, {"schemaVersion": 1, "status": "COMPLETE", "digest": expected_digest})


def run_request(data: Path, request: Path) -> None:
    regular_path(data)
    regular_path(request)
    value = json.loads(request.read_text())
    if value == {"operation": "none"}:
        return
    if not isinstance(value, dict) or type(value.get("id")) is not str:
        raise ValueError("Invalid Skylands transfer request")
    keys = {"operation", "id", "volumeDigest"}
    if value.get("operation") == "install":
        keys.add("digest")
    if set(value) != keys or value["operation"] not in {"export", "install"}:
        raise ValueError("Unknown Skylands transfer operation or fields")
    if not isinstance(value["volumeDigest"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["volumeDigest"]):
        raise ValueError("Invalid volume identity digest")
    volume_marker = data / ".the-storm-retired-worlds.json"
    regular_path(volume_marker)
    if files.digest(volume_marker) != value["volumeDigest"]:
        print("Skylands transfer request does not target this volume; no action")
        return
    if value["operation"] == "export":
        export_world(data, value["id"])
    elif isinstance(value["digest"], str):
        install_world(data, value["id"], value["digest"])
    else:
        raise ValueError("Unknown Skylands transfer operation or fields")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--request", type=Path)
    operation.add_argument("--inspect", type=Path)
    arguments = parser.parse_args()
    if arguments.inspect is not None:
        manifest = validate_payload(arguments.inspect)
        print(json.dumps({"files": len(manifest), "digest": manifest_digest(manifest)}))
    elif arguments.data is None:
        parser.error("--request requires --data")
    else:
        run_request(arguments.data, arguments.request)
