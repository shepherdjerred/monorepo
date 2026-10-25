"""Extract the pinned upstream tree, retaining its two confined test links."""

from __future__ import annotations

import sys
import tarfile
from pathlib import Path, PurePosixPath

LINKS = {
    "Tests/IntegrationTests/Resources/_9_symlinked_paths/LinkToFile.swift": ("Real/Target.swift", "file"),
    "Tests/IntegrationTests/Resources/_9_symlinked_paths/LinkToFolder": ("Real/Folder", "directory"),
}


def extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() or any(destination.iterdir()):
        raise ValueError("SwiftLint source destination must be a fresh owned directory")
    entries: dict[str, tarfile.TarInfo] = {}
    with tarfile.open(archive) as source:
        prefix: str | None = None
        for member in source.getmembers():
            raw = member.name.rstrip("/")
            path = PurePosixPath(raw)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.as_posix() != raw:
                raise ValueError("SwiftLint source member escapes its root")
            if prefix is None:
                prefix = path.parts[0]
            if path.parts[0] != prefix:
                raise ValueError("SwiftLint source archive has multiple roots")
            relative = PurePosixPath(*path.parts[1:]).as_posix()
            if relative in entries or member.islnk() or not (member.isdir() or member.isfile() or member.issym()):
                raise ValueError("SwiftLint source has a duplicate or unsupported entry")
            if relative == "." and not member.isdir():
                raise ValueError("SwiftLint source root is not a directory")
            if member.issym() and (relative not in LINKS or member.linkname != LINKS[relative][0]):
                raise ValueError("SwiftLint source contains an unapproved symbolic link")
            entries[relative] = member
        actual_links = {name for name, member in entries.items() if member.issym()}
        if actual_links != LINKS.keys():
            raise ValueError("SwiftLint source is missing its pinned symbolic links")
        for name in entries:
            for parent in PurePosixPath(name).parents:
                ancestor = entries.get(parent.as_posix())
                if ancestor is not None and not ancestor.isdir():
                    raise ValueError("SwiftLint source writes through a non-directory ancestor")
        for name, (target, kind) in LINKS.items():
            target_path = PurePosixPath(name).parent / target
            target_member = entries.get(target_path.as_posix())
            if (
                target_member is None
                or (kind == "file" and not target_member.isfile())
                or (kind == "directory" and not target_member.isdir())
            ):
                raise ValueError("SwiftLint source link target has the wrong declared type")
        # No links exist during file writes, regardless of archive entry order.
        for name, member in entries.items():
            target = destination.joinpath(*PurePosixPath(name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                data = source.extractfile(member)
                if data is None:
                    raise ValueError("SwiftLint source member has no file data")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data.read())
                target.chmod(member.mode & 0o777)
        root = destination.resolve(strict=True)
        for name, (link, kind) in LINKS.items():
            target = destination.joinpath(*PurePosixPath(name).parts)
            resolved = (target.parent / link).resolve(strict=True)
            if (
                not resolved.is_relative_to(root)
                or (kind == "file" and not resolved.is_file())
                or (kind == "directory" and not resolved.is_dir())
            ):
                raise ValueError("SwiftLint source link target is not a confined materialized target")
            target.symlink_to(link, target_is_directory=kind == "directory")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract-source.py <pinned-archive> <fresh-owned-directory>")
    extract(Path(sys.argv[1]), Path(sys.argv[2]))
