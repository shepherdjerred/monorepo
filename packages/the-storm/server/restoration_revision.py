"""Revise a verified installation before its first Paper startup, retaining both versions."""

import os
import shutil
import uuid
from contextlib import ExitStack
from pathlib import Path

import restoration_files as storage
from restoration_json import JsonObject


def revise(data: Path, payload: Path, plan: JsonObject, baked_jar: Path) -> JsonObject:
    if plan.get("status") != "VERIFIED_INSTALLATION_PLAN" or storage.digest(baked_jar) != plan.string(
        "candidateJarSha256"
    ):
        raise ValueError("Revision requires the exact verified replacement plugin")
    request = plan.string("requestId")
    if str(uuid.UUID(request)) != request:
        raise ValueError("Revision requires a canonical request UUID")
    expected = storage.installation_manifest(plan.strings("installationFiles"))
    if storage.files(payload) != expected or data.is_symlink():
        raise ValueError("Revision payload changed or data root is linked")
    data = data.resolve(strict=True)
    payload = payload.resolve(strict=True)
    if data.is_relative_to(payload) or payload.is_relative_to(data):
        raise ValueError("Revision requires independent payload storage")
    root = data / storage.WORKSPACE / request
    revision = root / "revision"
    for path in (root.parent, root, root / "journal.json", revision, revision / "journal.json"):
        if path.is_symlink():
            raise ValueError("Revision workspace cannot be linked")
    prior = plan.object("revisionOf")
    current = JsonObject.parse((root / "journal.json").read_bytes())
    if (
        current.get("requestId") != request
        or current.get("backupUid") != plan.get("backupUid")
        or current.strings("original") != plan.strings("originalFiles")
        or current.get("privateStartup") != "PENDING"
    ):
        raise ValueError("Revision requires the same unstarted installation and verified backup")
    revision_journal = revision / "journal.json"
    if not revision_journal.exists():
        if revision.exists():
            # No copies or renames can run before the first durable journal. An
            # interrupted bootstrap may leave an empty directory or its unpublished
            # atomic-write file; reconstruct only after verifying the entire old volume.
            if not revision.is_dir() or any(
                child.name != "journal.json.writing" or not child.is_file() for child in revision.iterdir()
            ):
                raise ValueError("Uninitialized revision workspace contains unexpected entries")
            storage.files(revision)  # Refuse linked or non-regular unpublished journal bytes.
        if (
            current.get("phase") != "INSTALLED"
            or current.get("candidateImage") != prior.get("candidateImage")
            or current.get("candidateJarSha256") != prior.get("candidateJarSha256")
            or current.strings("installation") != prior.strings("installationFiles")
        ):
            raise ValueError("Revision supersedes a different installation")
        storage.commit(data, request)  # Complete old-volume and installed-file readback before staging.
        required = sum((payload / name).stat().st_size for name in expected)
        if shutil.disk_usage(data).free < required * 2:
            raise ValueError("Insufficient space for independent revision staging")
        revision.mkdir(mode=0o700, exist_ok=True)
        state = JsonObject(
            {
                "phase": "STAGING",
                "plan": plan,
                "previous": current,
                "baseline": storage.files(data, exclude_workspace=True),
            }
        )
        storage.save(revision / "journal.json", state)
    state = JsonObject.parse((revision / "journal.json").read_bytes())
    if state.object("plan") != plan or state.get("phase") not in ("STAGING", "STAGED", "COMMITTING", "INSTALLED"):
        raise ValueError("Revision workspace belongs to different inputs")
    original = current.strings("original")
    archived_targets = current.string_list("targets")
    if storage.files(root / "original") != {
        name: checksum
        for name, checksum in original.items()
        if any(name == target or name.startswith(target + "/") for target in archived_targets)
    }:
        raise ValueError("Original rollback archive changed during revision")
    staged, previous = revision / "staged", revision / "previous"
    storage.files(revision)  # Reject linked or non-regular parents before any resumed copy.
    with ExitStack() as locks:
        for directory in (data, previous):
            if (directory / "world/level.dat").is_file():
                locks.enter_context(storage.stopped(directory))
        if state.get("phase") == "STAGING":
            if storage.files(data, exclude_workspace=True) != state.strings("baseline"):
                raise ValueError("Installed data changed before revision staging")
            staged.mkdir(mode=0o2775, exist_ok=True)
            for name, checksum in expected.items():
                source, destination = payload / name, staged / name
                destination.parent.mkdir(mode=0o2775, parents=True, exist_ok=True)
                if destination.is_symlink():
                    raise ValueError("Revision staging contains a linked target")
                # STAGING can resume a partially copied file; only private staged bytes are replaced.
                with source.open("rb") as input_file, destination.open("wb") as output:
                    shutil.copyfileobj(input_file, output)
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(destination, 0o664)
                if storage.digest(destination) != checksum or storage.digest(source) != checksum:
                    raise ValueError("Revision staging changed during copy")
            for directory in staged.rglob("*"):
                if directory.is_dir():
                    os.chmod(directory, 0o2775)
            if storage.files(staged) != expected:
                raise ValueError("Revision staging failed readback")
            state["phase"] = "STAGED"
            storage.save(revision / "journal.json", state)
        targets = ("world", storage.DATABASE)
        baseline = state.strings("baseline")
        old_files = state.object("previous").strings("installation")
        actual = storage.files(data, exclude_workspace=True)
        pending = storage.files(staged)
        before = {
            name: checksum
            for name, checksum in actual.items()
            if not any(name == target or name.startswith(target + "/") for target in targets)
        }
        archived = storage.files(previous) if previous.exists() else {}
        for name, checksum in actual.items():
            if name in before:
                continue
            if name in archived:
                if name not in expected or name in pending or checksum != expected[name]:
                    raise ValueError("Installed revision changed before first startup")
            else:
                before[name] = checksum
        before.update(archived)
        if before != baseline or archived != {name: old_files[name] for name in archived if name in old_files}:
            raise ValueError("Previous installation or unrelated volume files changed during revision")
        installed = {name: actual[name] for name in expected if name not in pending and name in actual}
        if {**pending, **installed} != expected or set(pending) & set(installed):
            raise ValueError("Revision installation changed or is incomplete")
        if state.get("phase") != "INSTALLED":
            state["phase"] = "COMMITTING"
            storage.save(revision / "journal.json", state)
            previous.mkdir(mode=0o700, exist_ok=True)
            for name in targets:
                source, destination = data / name, previous / name
                if not destination.exists():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    source.rename(destination)
                    storage.sync_directory(source.parent)
                    storage.sync_directory(destination.parent)
            for name in targets:
                source, destination = staged / name, data / name
                if source.exists():
                    if destination.exists() or destination.is_symlink():
                        raise ValueError("Revision target is already occupied")
                    source.rename(destination)
                    storage.sync_directory(source.parent)
                    storage.sync_directory(destination.parent)
            if storage.files(staged) or any(
                storage.digest(data / name) != checksum for name, checksum in expected.items()
            ):
                raise ValueError("Revised installation failed readback")
            state["phase"] = "INSTALLED"
            storage.save(revision / "journal.json", state)
        updated = JsonObject(
            {
                **state.object("previous"),
                "installation": expected,
                "candidateImage": plan.string("candidateImage"),
                "candidateJarSha256": plan.string("candidateJarSha256"),
                "revisionReceiptSha256": storage.digest(revision / "journal.json"),
            }
        )
        storage.save(root / "journal.json", updated)
        return JsonObject(
            {
                "phase": "INSTALLED",
                "requestId": request,
                "candidateImage": plan.string("candidateImage"),
                "candidateJarSha256": plan.string("candidateJarSha256"),
                "backupUid": plan.string("backupUid"),
                "files": len(expected),
                "coreProtectEpoch": request,
                "privateStartup": "PENDING",
                "revisionReceiptSha256": updated.string("revisionReceiptSha256"),
            }
        )
