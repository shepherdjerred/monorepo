"""Validate a closed producer archive before installing its private runtime."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import struct
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


def install(export: Path, pins_path: Path, destination: Path) -> Path:
    pins: object = json.loads(pins_path.read_text(encoding="utf-8"))
    if not isinstance(pins, dict):
        raise ValueError("Invalid SwiftLint input pins")
    revision = pins.get("sourceRevision")
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Invalid SwiftLint source revision")
    checksum = (export / "runtime.tar.gz.sha256").read_text(encoding="utf-8")
    match = re.fullmatch(r"([a-f0-9]{64})  runtime\.tar\.gz\n", checksum)
    archive = export / "runtime.tar.gz"
    if match is None or hashlib.sha256(archive.read_bytes()).hexdigest() != match[1]:
        raise ValueError("SwiftLint producer archive checksum mismatch")
    value: object = json.loads((export / "runtime.manifest.json").read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not value:
        raise ValueError("Invalid SwiftLint producer manifest")
    manifest: dict[str, str] = {}
    for name, digest in value.items():
        if not isinstance(name, str) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid SwiftLint producer file pin")
        path = PurePosixPath(name)
        if (
            path.is_absolute()
            or ".." in path.parts
            or path.parts[:2] != ("opt", "swiftlint")
            or path.as_posix() != name
        ):
            raise ValueError("SwiftLint producer path escapes its private runtime")
        manifest[name] = digest
    required = {
        "opt/swiftlint/bin/swiftlint",
        "opt/swiftlint/lib/libsourcekitdInProc.so",
        "opt/swiftlint/swiftlint",
        "opt/swiftlint/contract/pins.json",
        "opt/swiftlint/licenses/SwiftLint-LICENSE",
        "opt/swiftlint/licenses/Swift-LICENSE.txt",
        "opt/swiftlint/licenses/LLVM-LICENSE.txt",
    }
    if not required <= manifest.keys() or not any(
        name.startswith("opt/swiftlint/licenses/swift-packages/") for name in manifest
    ):
        raise ValueError("SwiftLint producer runtime or licensing inventory is incomplete")
    if destination.is_symlink():
        raise ValueError("SwiftLint runtime root must not be a symlink")
    destination.mkdir(mode=0o755, parents=True, exist_ok=True)
    if destination.stat().st_uid != os.geteuid() or destination.stat().st_mode & 0o022:
        raise ValueError("SwiftLint runtime root has unsafe ownership or permissions")
    with tempfile.TemporaryDirectory(prefix="swiftlint-validated-", dir=destination) as temporary:
        stage = Path(temporary)
        seen: set[str] = set()
        files_seen: set[str] = set()
        with tarfile.open(archive) as contents:
            for member in contents:
                name = member.name.rstrip("/")
                path = PurePosixPath(name)
                if (
                    path.is_absolute()
                    or ".." in path.parts
                    or path.parts[:2] != ("opt", "swiftlint")
                    or path.as_posix() != name
                ):
                    raise ValueError("SwiftLint archive entry escapes its private runtime")
                if name in seen or not (member.isdir() or member.isfile()):
                    raise ValueError("SwiftLint archive has a duplicate or unsupported entry")
                if member.mode & 0o7022:
                    raise ValueError("SwiftLint archive has unsafe permissions")
                seen.add(name)
                target = stage.joinpath(*path.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                source = contents.extractfile(member)
                if source is None or name not in manifest:
                    raise ValueError("SwiftLint archive contains an unpinned file")
                data = source.read()
                if hashlib.sha256(data).hexdigest() != manifest[name]:
                    raise ValueError("SwiftLint archive file checksum mismatch")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                target.chmod(member.mode & 0o777)
                files_seen.add(name)
        if files_seen != manifest.keys():
            raise ValueError("SwiftLint archive is missing a pinned file")
        staged = stage / "opt/swiftlint"
        for executable in (staged / "bin/swiftlint", staged / "swiftlint"):
            if executable.stat().st_mode & 0o111 != 0o111:
                raise ValueError("SwiftLint producer launcher or binary is not executable")
        if json.loads((staged / "contract/pins.json").read_text(encoding="utf-8")) != pins:
            raise ValueError("SwiftLint artifact belongs to a different producer input")
        machines = {"x86_64": 62, "aarch64": 183, "arm64": 183}
        machine = machines.get(platform.machine())
        if machine is None:
            raise ValueError("Unsupported SwiftLint runtime host architecture")
        for binary in [staged / "bin/swiftlint", *(staged / "lib").glob("*.so")]:
            header = binary.read_bytes()[:20]
            if (
                len(header) != 20
                or header[:6] != b"\x7fELF\x02\x01"
                or struct.unpack_from("<H", header, 18)[0] != machine
            ):
                raise ValueError("SwiftLint producer has an incompatible ELF artifact")
        identity = hashlib.sha256(json.dumps(pins, sort_keys=True).encode()).hexdigest()
        installed = destination / identity
        if installed.exists() or installed.is_symlink():
            if installed.is_symlink() or not installed.is_dir():
                raise ValueError("SwiftLint runtime destination is not an owned directory")
            if any(path.is_symlink() for path in installed.rglob("*")):
                raise ValueError("Existing SwiftLint runtime contains an unexpected symlink")
            for path in [installed, *installed.rglob("*")]:
                if path.stat().st_uid != os.geteuid() or path.stat().st_mode & 0o7022:
                    raise ValueError("Existing SwiftLint runtime has unsafe ownership or permissions")
            existing = {
                "opt/swiftlint/" + str(path.relative_to(installed)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in installed.rglob("*")
                if path.is_file()
            }
            if existing != manifest:
                raise ValueError("Existing SwiftLint runtime does not match its producer manifest")
        else:
            shutil.move(staged, installed)
        return installed


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: install-runtime.py <export> <pins.json> <private-runtime-root>")
    print(install(*(Path(argument) for argument in sys.argv[1:])))
