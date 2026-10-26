"""Stopped-file checks for world maintenance; no backup, restore or deployment operations."""

import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
from collections.abc import Mapping
from contextlib import ExitStack, contextmanager
from pathlib import Path, PurePosixPath

WORKSPACE = ".storm-maintenance"
DATABASE = "plugins/TheStorm/the-storm.db"


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def checked_manifest(value: Mapping[str, str]) -> dict[str, str]:
    if not value:
        raise ValueError("Expected a nonempty sealed file manifest")
    for name, checksum in value.items():
        path = PurePosixPath(name)
        if (
            not name or path.is_absolute() or ".." in path.parts or str(path) != name
            or not re.fullmatch(r"[a-f0-9]{64}", checksum)
        ):
            raise ValueError("Invalid sealed file path or checksum")
    return dict(sorted(value.items()))


def files(root: Path) -> dict[str, str]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Expected an existing regular directory")
    result = {}
    for directory, directories, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        for name in directories.copy():
            child = parent / name
            if child.is_mount():
                if child != root / "bluemap":
                    raise ValueError("Unexpected nested mount in the world volume")
                directories.remove(name)
        for name in directories + names:
            child = parent / name
            mode = child.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError("Volume contains linked or non-regular data")
            if stat.S_ISREG(mode) and name != "session.lock":
                result[child.relative_to(root).as_posix()] = digest(child)
    return dict(sorted(result.items()))


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def preserve_metadata(source: Path, destination: Path) -> None:
    original, copied = source.stat(), destination.stat()
    if (original.st_uid, original.st_gid) != (copied.st_uid, copied.st_gid):
        os.chown(destination, original.st_uid, original.st_gid, follow_symlinks=False)
    shutil.copystat(source, destination, follow_symlinks=False)
    copied = destination.stat()
    if (original.st_uid, original.st_gid, stat.S_IMODE(original.st_mode)) != (
        copied.st_uid, copied.st_gid, stat.S_IMODE(copied.st_mode)
    ):
        raise ValueError("Maintenance could not retain original file access metadata")


def save(path: Path, value: Mapping[str, object]) -> None:
    temporary = path.with_name(path.name + ".writing")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


@contextmanager
def stopped(root: Path):
    """Hold every native world lock; these scripts never stop or deploy the server."""
    if root.is_symlink() or not (root / "world/level.dat").is_file():
        raise ValueError("Maintenance requires the expected existing world")
    with ExitStack() as stack:
        for lock in sorted(root.rglob("session.lock")):
            if lock.is_symlink() or not lock.is_file():
                raise ValueError("World lock is not a regular file")
            handle = stack.enter_context(lock.open("r+b"))
            try:
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as failure:
                raise ValueError("Paper still holds a world save lock") from failure
        yield
