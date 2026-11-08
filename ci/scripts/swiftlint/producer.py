"""Run the pinned Linux SwiftLint producer stages outside Dockerfile heredocs."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import resource
import shutil
import subprocess
import sys
import urllib.request


def prepare_source() -> None:
    pins = json.loads(pathlib.Path("/swiftlint-input/pins.json").read_text())
    if pins["builderImage"] != os.environ["SWIFTLINT_BUILDER_IMAGE"]:
        raise SystemExit("SwiftLint builder does not match its reviewed pin")
    archive = pathlib.Path("/swiftlint-source.tar.gz")
    with urllib.request.urlopen(pins["sourceArchive"], timeout=60) as response:
        archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != pins["sourceArchiveSHA256"]:
        raise SystemExit("SwiftLint source archive checksum mismatch")
    subprocess.run(
        ["python3", "/swiftlint-input/extract-source.py", str(archive), "/swiftlint-source"], check=True
    )
    archive.unlink()
    licenses = pathlib.Path("/swiftlint-input/licenses")
    licenses.mkdir()
    for license in pins["runtimeLicenses"]:
        with urllib.request.urlopen(license["url"], timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != license["sha256"]:
            raise SystemExit("Swift toolchain license checksum mismatch")
        (licenses / license["name"]).write_bytes(data)


def compile_source() -> None:
    if sys.platform == "linux":
        os.sched_setaffinity(0, set(sorted(os.sched_getaffinity(0))[:2]))
    else:
        raise SystemExit("The SwiftLint compiler requires Linux CPU affinity")
    resource.setrlimit(resource.RLIMIT_AS, (8 * 1024**3, 8 * 1024**3))
    subprocess.run(
        [
            "swift", "build", "--configuration", "release", "--product", "swiftlint",
            "--jobs", "2", "--disable-automatic-resolution",
        ],
        check=True,
    )


def collect_licenses() -> None:
    target = pathlib.Path("/swiftlint-output/opt/swiftlint/licenses")
    for root, namespace in [
        (pathlib.Path("/swiftlint-source/.build/checkouts"), "swift-packages"),
        (pathlib.Path("/usr/share/doc"), "builder-runtime"),
    ]:
        for source in sorted(root.rglob("*")):
            if source.is_file() and (
                source.name.lower().startswith(("license", "notice", "copying")) or source.name == "copyright"
            ):
                destination = target / namespace / source.relative_to(root)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
    if not (target / "swift-packages").is_dir():
        raise SystemExit("SwiftLint dependency license inventory is missing")


def export_runtime() -> None:
    root = pathlib.Path("/opt/swiftlint")
    files = sorted(path for path in root.rglob("*") if path.is_file())
    manifest = {str(path.relative_to("/")): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    pathlib.Path("/runtime.manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    subprocess.run(
        [
            "tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
            "-czf", "/runtime.tar.gz", "-C", "/", "opt/swiftlint",
        ],
        check=True,
    )
    digest = hashlib.sha256(pathlib.Path("/runtime.tar.gz").read_bytes()).hexdigest()
    pathlib.Path("/runtime.tar.gz.sha256").write_text(digest + "  runtime.tar.gz\n")


if __name__ == "__main__":
    if sys.platform != "linux":
        raise SystemExit("The SwiftLint producer requires its configured Linux build stages")
    if len(sys.argv) != 2:
        raise SystemExit("Usage: producer.py <prepare-source|compile-source|collect-licenses|export-runtime>")
    match sys.argv[1]:
        case "prepare-source":
            prepare_source()
        case "compile-source":
            compile_source()
        case "collect-licenses":
            collect_licenses()
        case "export-runtime":
            export_runtime()
        case _:
            raise SystemExit("Unknown SwiftLint producer stage")
