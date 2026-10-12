"""Stopped-volume installation primitives. The controller owns admission and storage identity checks."""

import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import uuid
from collections.abc import Mapping
from contextlib import ExitStack, contextmanager
from pathlib import Path, PurePosixPath

from restoration_json import JsonObject

WORKSPACE = ".storm-restoration"
DATABASE = "plugins/TheStorm/the-storm.db"
TARGETS = (
    "world",
    DATABASE,
    DATABASE + "-wal",
    DATABASE + "-shm",
    "plugins/CoreProtect/database.db",
    "plugins/CoreProtect/database.db-wal",
    "plugins/CoreProtect/database.db-shm",
    "bluemap",
)


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def checked_manifest(value: Mapping[str, str]) -> dict[str, str]:
    if not value:
        raise ValueError("Expected a nonempty sealed file manifest")
    result = {}
    for name, checksum in value.items():
        path = PurePosixPath(name)
        if (
            not name
            or path.is_absolute()
            or ".." in path.parts
            or str(path) != name
            or not re.fullmatch(r"[a-f0-9]{64}", checksum)
        ):
            raise ValueError("Invalid sealed file path or checksum")
        result[name] = checksum
    return dict(sorted(result.items()))


def files(root: Path, *, exclude_workspace: bool = False) -> dict[str, str]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Expected an existing regular directory")
    result = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if exclude_workspace and relative.parts[0] == WORKSPACE:
            continue
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError("Volume contains linked or non-regular data")
        if stat.S_ISREG(mode) and path.name != "session.lock":
            result[str(relative)] = digest(path)
    return result


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def preserve_metadata(source: Path, destination: Path) -> None:
    """A rollback cannot silently change access to identity, configuration or plugin data."""
    original, copied = source.stat(), destination.stat()
    if (original.st_uid, original.st_gid) != (copied.st_uid, copied.st_gid):
        os.chown(destination, original.st_uid, original.st_gid, follow_symlinks=False)
    shutil.copystat(source, destination, follow_symlinks=False)
    copied = destination.stat()
    if (copied.st_uid, copied.st_gid, stat.S_IMODE(copied.st_mode)) != (
        original.st_uid,
        original.st_gid,
        stat.S_IMODE(original.st_mode),
    ):
        raise ValueError("Whole-volume rollback could not retain original file access metadata")


def save(path: Path, journal: Mapping[str, object]) -> None:
    temporary = path.with_name(path.name + ".writing")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(journal, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


@contextmanager
def stopped(root: Path):
    """Hold every existing world save lock for the entire filesystem transaction."""
    if root.is_symlink() or not (root / "world/level.dat").is_file():
        raise ValueError("Installation requires the expected existing world")
    with ExitStack() as stack:
        for lock in sorted(root.glob("*/session.lock")):
            if lock.is_symlink() or not lock.is_file():
                raise ValueError("World lock is not a regular file")
            handle = stack.enter_context(lock.open("r+b"))
            try:
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as failure:
                raise ValueError("Paper still holds a world save lock") from failure
        yield


def installation_manifest(payload: Mapping[str, str]) -> dict[str, str]:
    """Deploy only world data and the prepared database, excluding private conversion evidence."""
    result = {
        name: checksum
        for name, checksum in checked_manifest(payload).items()
        if name.startswith("world/") or name == DATABASE
    }
    if not {"world/level.dat", DATABASE}.issubset(result) or any(
        PurePosixPath(name).name == "session.lock" for name in result
    ):
        raise ValueError("Prepared installation lacks its world or database, or carries a save lock")
    for dimension in ("settlement", "rustworks", "rwf"):
        prefix = "world/dimensions/minecraft/" + dimension + "/"
        if prefix + "data/paper/metadata.dat" not in result or not any(
            name.startswith(prefix + "region/") for name in result
        ):
            raise ValueError("Prepared installation lacks a retained arena dimension")
    return result


def stage(
    data: Path,
    payload: Path,
    manifest: Mapping[str, str],
    original: Mapping[str, str],
    request: str,
    candidate_image: str,
    candidate_jar: str,
    backup_uid: str,
) -> Path:
    """Copy sealed inputs onto the destination volume; no live target changes before full readback."""
    if str(uuid.UUID(request)) != request or not backup_uid:
        raise ValueError("Expected a canonical request and a verified backup identity")
    if not re.fullmatch(
        r"ghcr\.io/shepherdjerred/the-storm-server:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}", candidate_image
    ) or not re.fullmatch(r"[a-f0-9]{64}", candidate_jar):
        raise ValueError("Installation requires immutable image and plugin identities")
    if data.is_symlink() or payload.is_symlink():
        raise ValueError("Installation roots cannot be symlinks")
    data, payload = data.resolve(strict=True), payload.resolve(strict=True)
    if data.is_relative_to(payload) or payload.is_relative_to(data):
        raise ValueError("Preparation requires an independent payload outside the stopped data tree")
    expected = installation_manifest(manifest)
    sealed_original = checked_manifest(original)
    if any(PurePosixPath(name).parts[0] == WORKSPACE for name in sealed_original):
        raise ValueError("Original backup already contains a restoration workspace; inspect its owner")
    if files(payload) != checked_manifest(manifest):
        raise ValueError("Prepared activation payload changed after native verification")
    workspace = data / WORKSPACE
    if workspace.exists() or workspace.is_symlink():
        raise ValueError("Installation workspace already exists; retain and inspect its journal")
    required = sum((payload / name).stat().st_size for name in expected)
    if shutil.disk_usage(data).free < required * 2:
        raise ValueError("Insufficient space for staged installation and private startup")
    with stopped(data):
        if files(data) != sealed_original:
            raise ValueError("Stopped volume differs from its independently verified whole-volume backup")
        workspace.mkdir(mode=0o700)
        root = workspace / request
        root.mkdir(mode=0o700)
        journal = JsonObject(
            {
                "schemaVersion": 1,
                "requestId": request,
                "candidateImage": candidate_image,
                "candidateJarSha256": candidate_jar,
                "backupUid": backup_uid,
                "phase": "STAGING",
                "original": sealed_original,
                "installation": expected,
                "targets": [name for name in TARGETS if (data / name).exists()],
            }
        )
        save(root / "journal.json", journal)
        staged = root / "staged"
        staged.mkdir(mode=0o700)
        for name, checksum in expected.items():
            source, destination = payload / name, staged / name
            destination.parent.mkdir(mode=0o2775, parents=True, exist_ok=True)
            with source.open("rb") as input_file, destination.open("xb") as output:
                shutil.copyfileobj(input_file, output)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(destination, 0o664)
            if digest(destination) != checksum or digest(source) != checksum:
                raise ValueError("Staged installation file changed during copy")
        # mkdir's umask and implicit parent creation can otherwise remove group
        # write access. Paper runs as UID 1000 with the volume's GID 2000.
        for directory in staged.rglob("*"):
            if directory.is_dir():
                os.chmod(directory, 0o2775)
        if files(staged) != expected or files(data, exclude_workspace=True) != sealed_original:
            raise ValueError("Preparation changed a live target or the staged data")
        journal["phase"] = "STAGED"
        save(root / "journal.json", journal)
        return root


def commit(data: Path, request: str) -> JsonObject:
    """Resume journaled renames without deleting originals; the controller must keep Paper stopped."""
    if str(uuid.UUID(request)) != request or data.is_symlink():
        raise ValueError("Invalid installation request or data root")
    data = data.resolve(strict=True)
    root = data / WORKSPACE / request
    if root.is_symlink() or root.parent.is_symlink() or (root / "journal.json").is_symlink():
        raise ValueError("Installation workspace cannot be linked")
    journal = JsonObject.parse((root / "journal.json").read_bytes())
    if journal.get("requestId") != request or journal.get("schemaVersion") != 1:
        raise ValueError("Installation workspace belongs to another request")
    if journal.get("phase") not in ("STAGED", "COMMITTING", "INSTALLED"):
        raise ValueError("Only fully verified staging can be installed")
    expected = installation_manifest(journal.strings("installation"))
    original = checked_manifest(journal.strings("original"))
    targets = journal.string_list("targets")
    if len(targets) != len(set(targets)) or any(name not in TARGETS for name in targets):
        raise ValueError("Installation journal contains an unreviewed target")
    archived, staged = root / "original", root / "staged"
    # A partial commit may already have moved the old world lock. Hold that
    # original lock too, so resuming never races a process using the old save.
    with ExitStack() as locks:
        lock_roots = [directory for directory in (data, archived) if (directory / "world/level.dat").is_file()]
        if not lock_roots:
            raise ValueError("Both the original and staged live world are missing")
        for directory in lock_roots:
            locks.enter_context(stopped(directory))
        before: dict[str, str] = {}
        # Reconstruct the exact old volume from retained files plus moved originals.
        # New installed files are verified independently and never counted as old.
        for name, checksum in files(data, exclude_workspace=True).items():
            if any(name == target or name.startswith(target + "/") for target in targets):
                if name in expected and not (staged / name).exists() and (archived / "world").exists():
                    if checksum != expected[name]:
                        raise ValueError("An installed target changed before private startup")
                    continue
                if name not in original or checksum != original[name]:
                    raise ValueError("A live installation target changed outside the transaction")
            before[name] = checksum
        if archived.exists():
            for name, checksum in files(archived).items():
                if name in before:
                    raise ValueError("Both original and archived target data exist")
                before[name] = checksum
        if before != original:
            raise ValueError("The stopped whole volume changed before installation")
        pending = files(staged)
        installed = {name: digest(data / name) for name in expected if name not in pending and (data / name).is_file()}
        if {**pending, **installed} != expected or set(pending) & set(installed):
            raise ValueError("Prepared installation changed or is incomplete")
        if journal.get("phase") == "INSTALLED":
            if pending:
                raise ValueError("Completed installation still has uninstalled targets")
            return journal
        journal["phase"] = "COMMITTING"
        save(root / "journal.json", journal)
        archived.mkdir(mode=0o700, exist_ok=True)
        for name in targets:
            source, destination = data / name, archived / name
            if destination.exists():
                continue
            if not source.exists() or source.is_symlink():
                raise ValueError("Original installation target disappeared")
            destination.parent.mkdir(parents=True, exist_ok=True)
            source.rename(destination)
            sync_directory(source.parent)
            sync_directory(destination.parent)
        for name in ("world", DATABASE):
            source, destination = staged / name, data / name
            if source.exists():
                if destination.exists() or destination.is_symlink():
                    raise ValueError("A new installation destination is already occupied")
                source.rename(destination)
                sync_directory(source.parent)
                sync_directory(destination.parent)
        if files(staged) or any(digest(data / name) != checksum for name, checksum in expected.items()):
            raise ValueError("Installed data failed readback")
        if files(archived) != {
            name: checksum
            for name, checksum in original.items()
            if any(name == target or name.startswith(target + "/") for target in targets)
        }:
            raise ValueError("Archived originals failed readback")
        journal["phase"] = "INSTALLED"
        journal["coreProtectEpoch"] = request
        journal["privateStartup"] = "PENDING"
        journal["rollback"] = "REQUIRES_WHOLE_VOLUME_AND_ROLLBACK_IMAGE"
        save(root / "journal.json", journal)
        return journal


def stage_whole_rollback(data: Path, restored: Path, request: str) -> JsonObject:
    """Prepare all original volume files, including configuration and other plugins' runtime state."""
    if str(uuid.UUID(request)) != request or data.is_symlink() or restored.is_symlink():
        raise ValueError("Invalid rollback request or linked data root")
    data, restored = data.resolve(strict=True), restored.resolve(strict=True)
    if data.is_relative_to(restored) or restored.is_relative_to(data):
        raise ValueError("Rollback requires independently restored whole-volume data")
    root = data / WORKSPACE / request
    if root.is_symlink() or root.parent.is_symlink() or (root / "journal.json").is_symlink():
        raise ValueError("Rollback workspace cannot be linked")
    journal = JsonObject.parse((root / "journal.json").read_bytes())
    if journal.get("requestId") != request or journal.get("phase") not in ("STAGED", "COMMITTING", "INSTALLED"):
        raise ValueError("Rollback workspace does not identify this installation request")
    expected = checked_manifest(journal.strings("original"))
    if files(restored) != expected:
        raise ValueError("Independent whole-volume restore changed after byte verification")
    staged = root / "rollback-staged"
    if staged.exists() or staged.is_symlink() or "wholeRollback" in journal:
        raise ValueError("Rollback preparation already exists; retain its failed or verified evidence")
    if shutil.disk_usage(data).free < sum((restored / name).stat().st_size for name in expected) * 2:
        raise ValueError("Insufficient space for independent whole-volume rollback preparation")
    with ExitStack() as locks:
        lock_roots = [directory for directory in (data, root / "original") if (directory / "world/level.dat").is_file()]
        if not lock_roots:
            raise ValueError("Rollback has no original or installed world save to lock")
        for directory in [*lock_roots, restored]:
            locks.enter_context(stopped(directory))
        current = files(data, exclude_workspace=True)
        targets = sorted(path.name for path in data.iterdir() if path.name != WORKSPACE)
        if any(not name or "/" in name or name in (".", "..") for name in targets):
            raise ValueError("Invalid root target in rollback transaction")
        journal["wholeRollback"] = {"phase": "STAGING", "before": current, "targets": targets}
        save(root / "journal.json", journal)
        staged.mkdir(mode=0o700)
        for name, checksum in expected.items():
            source, destination = restored / name, staged / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            preserve_metadata(source, destination)
            with destination.open("rb") as output:
                os.fsync(output.fileno())
            if digest(destination) != checksum or digest(source) != checksum:
                raise ValueError("Whole-volume rollback data changed during copy")
        for directory in sorted(restored.rglob("*"), reverse=True):
            if directory.is_dir():
                destination = staged / directory.relative_to(restored)
                destination.mkdir(parents=True, exist_ok=True)
                preserve_metadata(directory, destination)
        if (
            files(staged) != expected
            or files(restored) != expected
            or files(data, exclude_workspace=True) != current
            or sorted(path.name for path in data.iterdir() if path.name != WORKSPACE) != targets
        ):
            raise ValueError("Rollback preparation changed or raced a volume writer")
        journal.object("wholeRollback")["phase"] = "STAGED"
        save(root / "journal.json", journal)
        return journal


def commit_whole_rollback(data: Path, request: str) -> JsonObject:
    """Restore the complete old volume by resumable renames; retain failed activation data for review."""
    if str(uuid.UUID(request)) != request or data.is_symlink():
        raise ValueError("Invalid whole-volume rollback request or data root")
    data = data.resolve(strict=True)
    root = data / WORKSPACE / request
    if root.is_symlink() or root.parent.is_symlink() or (root / "journal.json").is_symlink():
        raise ValueError("Rollback workspace cannot be linked")
    journal = JsonObject.parse((root / "journal.json").read_bytes())
    if journal.get("requestId") != request:
        raise ValueError("Rollback belongs to another installation request")
    rollback = journal.object("wholeRollback")
    if rollback.get("phase") not in ("STAGED", "COMMITTING", "RESTORED"):
        raise ValueError("Whole-volume rollback requires fully verified staging")
    expected, before = checked_manifest(journal.strings("original")), rollback.strings("before")
    targets = rollback.string_list("targets")
    if len(set(targets)) != len(targets) or any(
        not name or "/" in name or name in (".", "..", WORKSPACE) for name in targets
    ):
        raise ValueError("Invalid whole-volume rollback target")
    staged, archived = root / "rollback-staged", root / "failed-activation"
    replacement_targets = sorted({PurePosixPath(name).parts[0] for name in expected})
    with ExitStack() as locks:
        lock_roots = [
            directory for directory in (data, root / "original", archived) if (directory / "world/level.dat").is_file()
        ]
        if not lock_roots:
            raise ValueError("Whole-volume rollback has no existing save to lock")
        for directory in lock_roots:
            locks.enter_context(stopped(directory))
        actual = files(data, exclude_workspace=True)
        pending = files(staged)
        reconstructed_before = {}
        installed = {}
        for name, checksum in actual.items():
            target = PurePosixPath(name).parts[0]
            if (target not in targets or (archived / target).exists()) and not (staged / target).exists():
                installed[name] = checksum
            else:
                reconstructed_before[name] = checksum
        if archived.exists():
            for name, checksum in files(archived).items():
                if name in reconstructed_before:
                    raise ValueError("Both archived and live failed activation data exist")
                reconstructed_before[name] = checksum
        if reconstructed_before != before or {**pending, **installed} != expected or set(pending) & set(installed):
            raise ValueError("Whole-volume rollback inputs or failed activation data changed")
        if any(path.name not in {*targets, *replacement_targets, WORKSPACE} for path in data.iterdir()):
            raise ValueError("An unexpected root target appeared during rollback")
        if rollback.get("phase") == "RESTORED":
            if pending or actual != expected:
                raise ValueError("Completed whole-volume rollback changed before restarting")
            return journal
        rollback["phase"] = "COMMITTING"
        save(root / "journal.json", journal)
        archived.mkdir(mode=0o700, exist_ok=True)
        for name in targets:
            source, destination = data / name, archived / name
            if destination.exists():
                continue
            if not source.exists() or source.is_symlink():
                raise ValueError("A failed activation root target disappeared")
            source.rename(destination)
            sync_directory(source.parent)
            sync_directory(destination.parent)
        for name in replacement_targets:
            source, destination = staged / name, data / name
            if source.exists():
                if destination.exists() or destination.is_symlink():
                    raise ValueError("An old-volume rollback destination is occupied")
                source.rename(destination)
                sync_directory(source.parent)
                sync_directory(destination.parent)
        if files(data, exclude_workspace=True) != expected or files(staged):
            raise ValueError("Restored whole volume failed readback")
        if files(archived) != before:
            raise ValueError("Failed activation archive changed during whole-volume rollback")
        rollback["phase"] = "RESTORED"
        rollback["restart"] = "REQUIRES_RECORDED_ROLLBACK_IMAGE"
        journal["phase"] = "WHOLE_VOLUME_RESTORED"
        save(root / "journal.json", journal)
        return journal
