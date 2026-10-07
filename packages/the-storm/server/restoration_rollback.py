"""Private writer operations for a controller-owned, verified whole-volume rollback."""

import argparse
import json
import sys
import tarfile
import uuid
from pathlib import Path, PurePosixPath
from typing import IO

import restoration_files as files
from restoration_json import JsonObject


def checked_proof(proof: JsonObject) -> dict[str, str]:
    request = proof.string("requestId")
    if (
        str(uuid.UUID(request)) != request
        or proof.get("schemaVersion") != 1
        or proof.get("status") != "VERIFIED"
        or not all(proof.string(key) for key in ("backupUid", "sourceVolumeUid", "restoredVolumeUid"))
        or proof["sourceVolumeUid"] == proof["restoredVolumeUid"]
    ):
        raise ValueError("Rollback requires this request's verified whole-volume proof")
    return files.checked_manifest(proof.strings("files"))


def transaction(data: Path, proof: JsonObject) -> JsonObject:
    expected = checked_proof(proof)
    request = proof.string("requestId")
    root = data / files.WORKSPACE / request
    if data.is_symlink() or root.parent.is_symlink() or root.is_symlink() or (root / "journal.json").is_symlink():
        raise ValueError("Rollback transaction paths cannot be linked")
    journal = JsonObject.parse((root / "journal.json").read_bytes())
    if journal.get("requestId") != request or journal.strings("original") != expected:
        raise ValueError("Installation transaction differs from the recorded whole-volume backup")
    if journal.get("phase") not in ("STAGED", "COMMITTING", "INSTALLED", "WHOLE_VOLUME_RESTORED"):
        raise ValueError("Rollback requires a recorded installation transaction")
    rollback = journal.object("wholeRollback", {})
    if rollback and rollback.get("phase") not in ("STAGED", "COMMITTING", "RESTORED"):
        raise ValueError("Incomplete whole-volume rollback staging requires inspection")
    return journal


def summary(journal: JsonObject) -> JsonObject:
    return JsonObject(
        {
            "requestId": journal.string("requestId"),
            "phase": journal.string("phase"),
            "rollbackPhase": journal.object("wholeRollback", {}).get("phase", "NOT_STAGED"),
            "files": len(journal.strings("original")),
        }
    )


def receive(source: Path, proof: JsonObject, stream: IO[bytes]) -> None:
    """Extract verified data only inside pod scratch, preserving original access metadata."""
    expected = checked_proof(proof)
    if source.exists() or source.is_symlink() or not source.parent.is_dir() or source.parent.is_symlink():
        raise ValueError(
            "Rollback transfer requires fresh private scratch; recreate the writer after a failed transfer"
        )
    source.mkdir(mode=0o700)
    seen: set[str] = set()

    def checked(member: tarfile.TarInfo, destination: str) -> tarfile.TarInfo:
        relative = PurePosixPath(member.name)
        name = str(relative)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or not (member.isdir() or member.isfile())
            or member.uid < 0
            or member.gid < 0
            or (member.isfile() and name not in expected and relative.name != "session.lock")
        ):
            raise ValueError("Rollback stream contains an unsafe or unverified entry")
        return member

    with tarfile.open(fileobj=stream, mode="r|") as archive:
        def members():
            for member in archive:
                name = str(PurePosixPath(member.name))
                if name in seen:
                    raise ValueError("Rollback stream contains an unsafe or unverified duplicate entry")
                seen.add(name)
                yield member

        archive.errorlevel = 2
        archive.extractall(source, members=members(), numeric_owner=True, filter=checked)
    if files.files(source) != expected:
        raise ValueError("Rollback scratch differs from the independently verified whole volume")


def restore(data: Path, source: Path, proof: JsonObject) -> JsonObject:
    journal = transaction(data, proof)
    request = proof.string("requestId")
    if not journal.object("wholeRollback", {}):
        files.stage_whole_rollback(data, source, request)
    return summary(files.commit_whole_rollback(data, request))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("inspect", "receive", "restore"))
    parser.add_argument("--proof", required=True, type=Path)
    parser.add_argument("--data", type=Path, default=Path("/data"))
    parser.add_argument("--source", type=Path, default=Path("/scratch/rollback-source"))
    arguments = parser.parse_args()
    if arguments.proof.is_symlink() or not arguments.proof.is_file():
        raise ValueError("Rollback proof must be a regular private file")
    proof = JsonObject.parse(arguments.proof.read_bytes())
    if arguments.operation == "receive":
        receive(arguments.source, proof, sys.stdin.buffer)
        result = {"requestId": proof.string("requestId"), "phase": "TRANSFER_VERIFIED"}
    elif arguments.operation == "restore":
        result = restore(arguments.data, arguments.source, proof)
    else:
        result = summary(transaction(arguments.data, proof))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
