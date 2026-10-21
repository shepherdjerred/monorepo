"""Add a verified creative world to stopped storage without replacing survival or player state."""

import argparse
import json
import os
import re
import shutil
import uuid
from pathlib import Path

import restoration_files as storage
from restoration_json import JsonObject

REGISTRY = "plugins/Multiverse-Core/worlds.yml"


def installation_files(plan: JsonObject) -> dict[str, str]:
    expected = storage.checked_manifest(plan.strings("files"))
    if (
        plan.get("status") != "VERIFIED_CREATIVE_INSTALLATION_PLAN"
        or str(uuid.UUID(plan.string("requestId"))) != plan.string("requestId")
        or "creative/level.dat" not in expected
        or REGISTRY not in expected
        or not any(name.startswith("creative/region/") for name in expected)
        or any(
            name not in ("creative/level.dat", REGISTRY)
            and not re.fullmatch(r"creative/region/r\.-?\d+\.-?\d+\.mca", name)
            for name in expected
        )
    ):
        raise ValueError("Creative installation permits only terrain, level metadata and its world registry")
    return expected


def install(data: Path, payload: Path, plan: JsonObject, baked_jar: Path) -> JsonObject:
    expected = installation_files(plan)
    original = storage.checked_manifest(plan.strings("originalFiles"))
    if (
        REGISTRY not in original
        or any(name.startswith("creative/") for name in original)
        or storage.digest(baked_jar) != plan.string("candidateJarSha256")
        or storage.files(payload) != expected
    ):
        raise ValueError("Creative installation inputs or original storage identity differ")
    workspace = data / storage.WORKSPACE
    root = workspace / plan.string("requestId") / "creative-install"
    if workspace.is_symlink() or root.parent.is_symlink() or root.is_symlink():
        raise ValueError("Creative installation workspace cannot be linked")
    with storage.stopped(data):
        receipt_path = root / "journal.json"
        staged = root / "new"
        before = root / "worlds-before.yml"
        if not root.exists():
            if (data / "creative").exists() or (data / "creative").is_symlink():
                raise ValueError("Creative already exists; refusing to overwrite it")
            if storage.files(data, exclude_workspace=True) != original:
                raise ValueError("Stopped volume changed since independent backup verification")
            root.mkdir(parents=True, mode=0o700)
            storage.save(receipt_path, {"phase": "STAGING", "plan": plan})
        if receipt_path.is_symlink():
            raise ValueError("Creative installation receipt cannot be linked")
        receipt = JsonObject.parse(receipt_path.read_bytes())
        if receipt.object("plan") != plan:
            raise ValueError("Creative installation belongs to different sealed inputs")
        if receipt.get("phase") == "STAGING":
            if storage.files(data, exclude_workspace=True) != original:
                raise ValueError("Stopped volume changed while preparing creative")
            if staged.exists() or staged.is_symlink():
                storage.files(staged)
            for name, checksum in expected.items():
                source, target = payload / name, staged / name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o2775)
                if target.is_symlink():
                    raise ValueError("Staged creative path cannot be linked")
                with source.open("rb") as reader, target.open("wb") as writer:
                    shutil.copyfileobj(reader, writer)
                    writer.flush()
                    os.fsync(writer.fileno())
                if storage.digest(target) != checksum:
                    raise ValueError("Creative staging readback differs")
                os.chown(target, 1000, 2000)
                target.chmod(0o664)
            for directory in (staged, *[path for path in staged.rglob("*") if path.is_dir()]):
                os.chown(directory, 1000, 2000)
                directory.chmod(0o2775)
            if storage.files(staged) != expected or storage.files(data, exclude_workspace=True) != original:
                raise ValueError("Creative payload or original data changed before commit")
            receipt["phase"] = "PREPARED"
            storage.save(receipt_path, receipt)
        if receipt.get("phase") == "PREPARED":
            observed = storage.files(data, exclude_workspace=True)

            def unrelated(entries: dict[str, str]) -> dict[str, str]:
                return {
                    name: checksum
                    for name, checksum in entries.items()
                    if name != REGISTRY and not name.startswith("creative/")
                }

            if unrelated(observed) != unrelated(original):
                raise ValueError("Unrelated survival or player data changed during creative installation")
            creative = data / "creative"
            world_files = {
                name.removeprefix("creative/"): checksum
                for name, checksum in expected.items()
                if name.startswith("creative/")
            }
            if creative.exists():
                if storage.files(creative) != world_files:
                    raise ValueError("Existing creative differs from the owned rename transaction")
            else:
                if storage.files(staged / "creative") != world_files:
                    raise ValueError("Prepared creative changed before rename")
                (staged / "creative").rename(creative)
                storage.sync_directory(data)
            registry = data / REGISTRY
            if registry.is_symlink() or before.is_symlink():
                raise ValueError("Creative world registry cannot be linked")
            if registry.exists() and storage.digest(registry) == original[REGISTRY]:
                if before.exists():
                    raise ValueError("Retained world registry already exists before its rename")
                registry.rename(before)
                storage.sync_directory(registry.parent)
            if not registry.exists():
                if not before.is_file() or storage.digest(before) != original[REGISTRY]:
                    raise ValueError("Original world registry was not retained")
                replacement = staged / REGISTRY
                if replacement.is_symlink() or storage.digest(replacement) != expected[REGISTRY]:
                    raise ValueError("Prepared world registry changed before rename")
                replacement.rename(registry)
                storage.sync_directory(registry.parent)
            if storage.digest(registry) != expected[REGISTRY]:
                raise ValueError("Creative world registry differs after commit")
            result = {**original, **expected}
            if storage.files(data, exclude_workspace=True) != dict(sorted(result.items())):
                raise ValueError("Creative installation changed unrelated survival or player data")
            receipt["phase"] = "INSTALLED"
            storage.save(receipt_path, receipt)
        if receipt.get("phase") != "INSTALLED":
            raise ValueError("Unknown creative installation phase")
        if storage.files(data, exclude_workspace=True) != dict(sorted({**original, **expected}.items())):
            raise ValueError("Installed creative or original data changed; private startup remains unauthorized")
        return JsonObject(
            {
                "phase": "INSTALLED",
                "requestId": plan.string("requestId"),
                "candidateJarSha256": plan.string("candidateJarSha256"),
                "files": len(expected),
                "unrelatedFiles": "UNCHANGED",
                "privateStartup": "PENDING",
            }
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("/data"))
    parser.add_argument("--payload", type=Path, default=Path("/scratch/payload"))
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--baked-jar", type=Path, default=Path("/plugins/TheStorm.jar"))
    args = parser.parse_args()
    if args.plan.is_symlink():
        raise ValueError("Creative plan cannot be linked")
    print(json.dumps(install(args.data, args.payload, JsonObject.parse(args.plan.read_bytes()), args.baked_jar)))


if __name__ == "__main__":
    main()
