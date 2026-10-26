"""Copy BlueMap to its own volume before Paper starts; retain the original until acceptance."""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
from collections.abc import Mapping
from pathlib import Path, PurePosixPath

RECEIPT = ".the-storm-bluemap-storage.json"


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def inventory(root: Path) -> dict[str, str]:
    result = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        parent = Path(directory)
        for name in directories + files:
            item = parent / name
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError("BlueMap migration refuses linked or special files")
        for name in files:
            item = parent / name
            relative = item.relative_to(root).as_posix()
            if relative in (RECEIPT, RECEIPT + ".writing"):
                continue
            result[relative] = digest(item)
    return dict(sorted(result.items()))


def manifest_digest(manifest: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def checked_manifest(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("BlueMap receipt lacks its file manifest")
    result = {}
    for name, checksum in value.items():
        if not isinstance(name, str) or not isinstance(checksum, str):
            raise ValueError("Invalid BlueMap manifest entry")
        path = PurePosixPath(name)
        if (
            path.is_absolute() or not path.parts or ".." in path.parts or str(path) != name
            or name in (RECEIPT, RECEIPT + ".writing") or not re.fullmatch(r"[a-f0-9]{64}", checksum)
        ):
            raise ValueError("Unsafe BlueMap manifest entry")
        result[name] = checksum
    return result


def write_receipt(destination: Path, value: Mapping[str, object]) -> None:
    temporary = destination / (RECEIPT + ".writing")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o664)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(destination / RECEIPT)
    descriptor = os.open(destination, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def mounts(data: Path, destination: Path) -> None:
    if data.is_symlink() or destination.is_symlink() or not data.is_dir() or not destination.is_dir():
        raise ValueError("Migration requires two existing regular volume roots")
    if not data.is_mount() or not destination.is_mount() or data.stat().st_dev == destination.stat().st_dev:
        raise ValueError("BlueMap destination must be a separate mounted filesystem")
    if data.resolve() in destination.resolve().parents or destination.resolve() in data.resolve().parents:
        raise ValueError("Migration volumes must not contain one another")


def read_receipt(destination: Path) -> dict[str, object]:
    path = destination / RECEIPT
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected the regular BlueMap migration receipt")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Unknown BlueMap migration receipt")
    manifest = checked_manifest(value.get("files"))
    if value.get("phase") not in ("COPYING", "VERIFIED", "SOURCE_REMOVED", "NEW_CACHE"):
        raise ValueError("Unknown BlueMap migration phase")
    if value.get("phase") == "NEW_CACHE":
        if manifest:
            raise ValueError("New cache receipt unexpectedly contains original renders")
    elif manifest_digest(manifest) != value.get("manifestSha256"):
        raise ValueError("BlueMap migration receipt manifest changed")
    return value


def copy(data: Path, destination: Path) -> dict[str, object]:
    """Retry partial copies, but never replay the original over an already active cache."""
    mounts(data, destination)
    source = data / "bluemap"
    if source.is_symlink() or (source.exists() and not source.is_dir()):
        raise ValueError("Original BlueMap cache must be a regular directory")
    receipt_path = destination / RECEIPT
    receipt: dict[str, object]
    if receipt_path.exists() or receipt_path.is_symlink():
        receipt = read_receipt(destination)
        if receipt.get("phase") in ("VERIFIED", "SOURCE_REMOVED", "NEW_CACHE"):
            return {"phase": receipt["phase"], "reused": True}
        if receipt.get("phase") != "COPYING":
            raise ValueError("Unknown BlueMap migration phase")
    else:
        if any(item.name != RECEIPT + ".writing" for item in destination.iterdir()):
            raise ValueError("Nonempty BlueMap volume has no migration receipt")
        if not source.exists():
            # A restored data volume deliberately has no render cache.
            receipt = {"schemaVersion": 1, "phase": "NEW_CACHE", "files": {}}
            write_receipt(destination, receipt)
            return {"phase": "NEW_CACHE", "files": 0}
        original = inventory(source)
        receipt = {"schemaVersion": 1, "phase": "COPYING", "files": original,
                   "manifestSha256": manifest_digest(original)}
        write_receipt(destination, receipt)
    expected = checked_manifest(receipt.get("files"))
    if (not source.is_dir() or inventory(source) != expected
            or manifest_digest(expected) != receipt.get("manifestSha256")):
        raise ValueError("Original BlueMap cache changed during migration")
    current = inventory(destination)
    if set(current) - set(expected):
        raise ValueError("Unexpected files appeared in the destination during migration")
    for relative, checksum in expected.items():
        target = destination / relative
        if current.get(relative) == checksum:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # Partial target files are rehashed and replaced when a copy resumes.
        with target.open("wb") as output, (source / relative).open("rb") as incoming:
            shutil.copyfileobj(incoming, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        shutil.copystat(source / relative, target, follow_symlinks=False)
        if digest(target) != checksum:
            raise ValueError("Copied BlueMap file differs from the original")
    if inventory(source) != expected or inventory(destination) != expected:
        raise ValueError("BlueMap migration failed complete checksum verification")
    receipt["phase"] = "VERIFIED"
    write_receipt(destination, receipt)
    return {"phase": "VERIFIED", "files": len(expected), "manifestSha256": receipt["manifestSha256"]}


def retire_source(data: Path, destination: Path, accepted_manifest: str) -> dict[str, object]:
    """Remove only the original cache, after operator acceptance of the mounted copy."""
    mounts(data, destination)
    receipt = read_receipt(destination)
    expected = checked_manifest(receipt.get("files"))
    if receipt.get("phase") not in ("VERIFIED", "SOURCE_REMOVED"):
        raise ValueError("Original cache removal requires the verified copy")
    if accepted_manifest != receipt.get("manifestSha256") or manifest_digest(expected) != accepted_manifest:
        raise ValueError("Acceptance belongs to a different BlueMap manifest")
    source = data / "bluemap"
    if source.is_symlink() or source.is_mount():
        raise ValueError("Refusing to remove a linked or mounted original cache")
    if source.exists():
        remaining = inventory(source)
        if any(expected.get(path) != checksum for path, checksum in remaining.items()):
            raise ValueError("Original cache changed since verified migration")
        # Delete exact manifest entries only. Interrupted cleanup resumes using
        # the same sealed manifest; unrelated files never become candidates.
        for relative in remaining:
            (source / relative).unlink()
        for directory, _, _ in os.walk(source, topdown=False):
            Path(directory).rmdir()
    receipt["phase"] = "SOURCE_REMOVED"
    write_receipt(destination, receipt)
    return {"phase": "SOURCE_REMOVED", "manifestSha256": accepted_manifest}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("copy", "retire-source"))
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--accepted-manifest")
    arguments = parser.parse_args()
    if arguments.operation == "retire-source" and arguments.accepted_manifest is None:
        parser.error("retire-source requires --accepted-manifest after live acceptance")
    result = (
        copy(arguments.data, arguments.destination)
        if arguments.operation == "copy"
        else retire_source(arguments.data, arguments.destination, arguments.accepted_manifest)
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
