"""Provision only fresh native resource metadata under the stopped restoration lease."""

import argparse
import json
import os
import shutil
from pathlib import Path

import restoration_files as storage
from restoration_json import JsonObject

DIMENSIONS = ("wilds", "peaks", "mining")
METADATA = ("data/paper/metadata.dat", "data/paper/level_overrides.dat", "data/minecraft/world_gen_settings.dat")
PATHS = {f"world/dimensions/minecraft/{name}/{file}" for name in DIMENSIONS for file in METADATA}


def validate_files(value: dict[str, str]) -> dict[str, str]:
    expected = storage.checked_manifest(value)
    if set(expected) != PATHS:
        raise ValueError("Fresh resource bootstrap allows only nine native metadata files")
    return expected


def plan(staging: Path, control: JsonObject, candidate: Path) -> JsonObject:
    root = staging / "resource-bootstrap"
    for path in (staging, staging / "restore-journal.json", root, root / "receipt.json", candidate):
        if path.is_symlink():
            raise ValueError("Resource bootstrap inputs cannot be linked")
    receipt = JsonObject.parse((root / "receipt.json").read_bytes())
    preparation = JsonObject.parse((staging / "restore-journal.json").read_bytes())
    if preparation.get("resourceReceiptSha256") != storage.digest(root / "receipt.json"):
        raise ValueError("Resource receipt changed after native preparation")
    owned = Path(__file__).resolve().parent
    expected = validate_files(receipt.strings("files"))
    native = receipt.object("native")
    if (
        receipt.get("status") != "VERIFIED"
        or receipt.get("testOnly") is not False
        or receipt.get("requestId") != control.string("requestId")
        or receipt.get("candidateJarSha256") != storage.digest(candidate)
        or receipt.get("candidateJarSha256") != control.object("installation").get("candidateJarSha256")
        or receipt.get("backupProofSha256") != control.object("export").get("proofSha256")
        or receipt.get("nativeToolSha256") != storage.digest(owned / "conversion/NativeResourceBootstrap.java")
        or native.get("status") != "VERIFIED"
        or native.get("requestId") != control.string("requestId")
        or native.get("dataVersion") != 4903
        or native.get("worldTicks") != 0
        or native.get("terrainGeneration") is not False
        or set(native.object("dimensions")) != set(DIMENSIONS)
        or storage.files(root / "payload") != expected
    ):
        raise ValueError("Resource bootstrap lacks exact request-owned native preparation evidence")
    return JsonObject(
        {
            "requestId": control.string("requestId"),
            "candidateImage": control.string("candidateImage"),
            "candidateJarSha256": receipt.string("candidateJarSha256"),
            "backupUid": control.object("backup").string("uid"),
            "receiptSha256": storage.digest(root / "receipt.json"),
            "payload": str(root / "payload"),
            "installationFiles": expected,
        }
    )


def install(data: Path, payload: Path, prepared: JsonObject, baked_jar: Path) -> JsonObject:
    """Resumable metadata creation; refuse terrain, foreign files and changes to all other data."""
    expected = validate_files(prepared.strings("installationFiles"))
    if storage.digest(baked_jar) != prepared.string("candidateJarSha256") or storage.files(payload) != expected:
        raise ValueError("Resource bootstrap requires exact published plugin and sealed metadata")
    workspace = data / storage.WORKSPACE / prepared.string("requestId")
    for path in (data, workspace.parent, workspace, workspace / "journal.json"):
        if path.is_symlink():
            raise ValueError("Resource workspace cannot be linked")
    installed = JsonObject.parse((workspace / "journal.json").read_bytes())
    if installed.get("phase") != "INSTALLED" or any(
        installed.get(key) != prepared.get(key)
        for key in ("requestId", "candidateImage", "candidateJarSha256", "backupUid")
    ):
        raise ValueError("Fresh resource bootstrap requires this completed installation")
    receipt_path = workspace / "resource-bootstrap.json"
    with storage.stopped(data):
        before = storage.files(data, exclude_workspace=True)
        current = {
            name: checksum
            for name, checksum in before.items()
            if any(name.startswith(f"world/dimensions/minecraft/{dimension}/") for dimension in DIMENSIONS)
        }
        if any(name not in expected or expected[name] != checksum for name, checksum in current.items()):
            raise ValueError("Resource dimensions contain existing terrain, foreign or changed metadata")
        untouched = {name: checksum for name, checksum in before.items() if name not in current}
        if receipt_path.is_symlink():
            raise ValueError("Resource receipt cannot be linked")
        if receipt_path.exists():
            receipt = JsonObject.parse(receipt_path.read_bytes())
            if receipt.object("plan") != prepared or receipt.strings("untouched") != untouched:
                raise ValueError("Resource bootstrap inputs or retained data changed during transaction")
        else:
            receipt = JsonObject({"phase": "PREPARED", "plan": prepared, "untouched": untouched})
            storage.save(receipt_path, receipt)
        owner = (data / "world/dimensions/minecraft/overworld/data").stat()
        # Multiverse 5.8 requires two recognized save entries: data plus the
        # empty region directory. No old terrain is imported or generated here.
        for dimension in DIMENSIONS:
            region = data / f"world/dimensions/minecraft/{dimension}/region"
            for parent in (region, *region.parents):
                if parent == data:
                    break
                if parent.is_symlink():
                    raise ValueError("Resource destination cannot have linked parents")
            region.mkdir(parents=True, exist_ok=True)
            for parent in (region, region.parent):
                os.chown(parent, owner.st_uid, owner.st_gid)
                os.chmod(parent, 0o770)
                storage.sync_directory(parent)
        for name, checksum in expected.items():
            destination = data / name
            for parent in destination.parents:
                if parent == data:
                    break
                if parent.is_symlink():
                    raise ValueError("Resource destination cannot have linked parents")
            if name not in current:
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = workspace / "resource-copy.writing"
                if temporary.is_symlink():
                    raise ValueError("Resource copy staging cannot be linked")
                shutil.copyfile(payload / name, temporary)
                os.chown(temporary, owner.st_uid, owner.st_gid)
                os.chmod(temporary, 0o660)
                with temporary.open("rb") as handle:
                    os.fsync(handle.fileno())
                if storage.digest(temporary) != checksum:
                    raise ValueError("Resource copy staging changed")
                temporary.replace(destination)
            os.chown(destination, owner.st_uid, owner.st_gid)
            os.chmod(destination, 0o660)
            for parent in destination.parents:
                if parent == data / "world/dimensions/minecraft":
                    break
                os.chown(parent, owner.st_uid, owner.st_gid)
                os.chmod(parent, 0o770)
                storage.sync_directory(parent)
            if storage.digest(destination) != checksum:
                raise ValueError("Resource metadata changed during installation")
        if storage.files(data, exclude_workspace=True) != {**untouched, **expected}:
            raise ValueError("Non-resource data changed during resource bootstrap")
        if storage.files(payload) != expected:
            raise ValueError("Resource payload changed during bootstrap")
        receipt["phase"] = "VERIFIED"
        storage.save(receipt_path, receipt)
        return JsonObject(
            {
                "phase": "VERIFIED",
                "requestId": prepared.string("requestId"),
                "candidateJarSha256": prepared.string("candidateJarSha256"),
                "receiptSha256": prepared.string("receiptSha256"),
                "files": len(expected),
                "nonResourceFilesUnchanged": len(untouched),
            }
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path("/data"))
    parser.add_argument("--payload", type=Path, default=Path("/scratch/payload"))
    parser.add_argument("--baked-jar", type=Path, default=Path("/plugins/TheStorm.jar"))
    args = parser.parse_args()
    print(json.dumps(install(args.data, args.payload, JsonObject.parse(args.plan.read_bytes()), args.baked_jar)))


if __name__ == "__main__":
    main()
