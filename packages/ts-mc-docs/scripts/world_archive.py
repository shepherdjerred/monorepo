#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Publish the Storm archive with bounded memory and one world on disk at a time.

Requires Python 3.12+, the pinned uNmINeD CLI, and an authenticated AWS profile. No
credentials or world data are written to the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from typing import Protocol, TypedDict

from world_previews import PreviewArea, level_metadata, png_dimensions, preview_areas


class ByteReader(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...


class WorldFiles(TypedDict):
    id: str
    file: str
    root: str


class World(WorldFiles):
    title: str
    date: str
    minecraft: str
    credit: str
    description: str


class Schematic(TypedDict):
    file: str
    title: str


class Catalog(TypedDict):
    release: str
    rendererUrl: str
    rendererSha256: str
    worlds: list[World]
    schematics: list[Schematic]


class DownloadMetadata(TypedDict):
    sourceSha256: str
    sha256: str
    bytes: int
    files: int


class PublishedDownload(DownloadMetadata):
    download: str


class PublishedPreview(TypedDict):
    kind: str
    url: str
    sha256: str
    bytes: int
    width: int
    height: int
    bounds: list[int]


class PublishedWorld(PublishedDownload):
    previews: list[PublishedPreview]


class PublishedSchematic(TypedDict):
    download: str
    sha256: str
    bytes: int


class Publication(TypedDict):
    release: str
    downloads: dict[str, PublishedDownload]
    worlds: dict[str, PublishedWorld]
    schematics: dict[str, PublishedSchematic]


PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
CATALOG = PACKAGE / "archive/catalog.json"
BUCKET = "ts-mc-docs"
ENDPOINT = "https://seaweedfs-s3.tailnet-1a49.ts.net"
ORIGIN = "https://docs.ts-mc.net"
GIB = 1024**3
RESERVE = 15 * GIB
CHUNK = 1024**2
AWS_ENV = {
    **os.environ,
    "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_REQUEST_CHECKSUM_CALCULATION": "WHEN_REQUIRED",
    "AWS_RESPONSE_CHECKSUM_VALIDATION": "WHEN_REQUIRED",
}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stream_sha256(stream: ByteReader) -> str:
    digest = hashlib.sha256()
    while block := stream.read(CHUNK):
        digest.update(block)
    return digest.hexdigest()


def load_catalog() -> Catalog:
    catalog: Catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    if not re.fullmatch(r"[a-z0-9-]+", catalog["release"]):
        raise ValueError("Invalid archive release")
    ids = [w["id"] for w in catalog["worlds"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate world IDs")
    for world in catalog["worlds"]:
        if not re.fullmatch(r"[a-z0-9-]+", world["id"]):
            raise ValueError("Invalid world ID")
        safe_parts(world["root"])
    for entry in catalog["worlds"] + catalog["schematics"]:
        if len(safe_parts(entry["file"])) != 1:
            raise ValueError("Archive source must be a top-level filename")
    return catalog


def safe_parts(name: str) -> tuple[str, ...]:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or "\0" in name:
        raise ValueError(f"Unsafe archive path: {name!r}")
    return path.parts


def retained_path(info: zipfile.ZipInfo, root: str) -> Path | None:
    parts = safe_parts(info.filename)
    if "__MACOSX" in parts or info.is_dir():
        return None
    if parts[-1] in {".DS_Store", "Thumbs.db", "session.lock"}:
        return None
    if stat.S_ISLNK(info.external_attr >> 16):
        raise ValueError(f"Symlink in world archive: {info.filename}")
    prefix = safe_parts(root)
    if parts[: len(prefix)] != prefix or len(parts) <= len(prefix):
        raise ValueError(f"File outside the declared world: {info.filename}")
    return Path(*parts[len(prefix) :])


def require_space(path: Path, additional: int = 0) -> None:
    free = shutil.disk_usage(path).free
    if free < RESERVE + additional:
        raise RuntimeError(
            f"Disk guard: {free / GIB:.1f} GiB free; need "
            f"{(RESERVE + additional) / GIB:.1f} GiB. Originals remain untouched."
        )


def prepare(source: Path, world: WorldFiles, work: Path) -> tuple[Path, DownloadMetadata]:
    """Normalize the download without extracting an entire world onto disk."""
    source_zip = source / world["file"]
    original_sha = sha256(source_zip)
    output = work / f"{world['id']}.zip"
    expected: dict[str, str] = {}
    with zipfile.ZipFile(source_zip) as original:
        retained = [(i, retained_path(i, world["root"])) for i in original.infolist()]
        members = [(i, p) for i, p in retained if p is not None]
        paths = [str(p) for _, p in members]
        if len(paths) != len(set(paths)) or "level.dat" not in paths:
            raise ValueError("World must have unique members and a root level.dat")
        unpacked = sum(i.file_size for i, _ in members)
        require_space(work, unpacked)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as cleaned:
            for index, (info, relative) in enumerate(members):
                if index % 100 == 0:
                    require_space(work)
                name = f"{world['id']}/{relative.as_posix()}"
                digest = hashlib.sha256()
                with (
                    original.open(info) as src,
                    cleaned.open(name, "w", force_zip64=True) as dst,
                ):
                    while block := src.read(CHUNK):
                        dst.write(block)
                        digest.update(block)
                expected[name] = digest.hexdigest()
    # Read the finished ZIP, not only its input, before publishing it.
    with zipfile.ZipFile(output) as cleaned:
        for info in cleaned.infolist():
            with cleaned.open(info) as stream:
                actual = stream_sha256(stream)
            if actual != expected[info.filename]:
                raise RuntimeError(f"Repack changed world data: {info.filename}")
    return output, {
        "sourceSha256": original_sha,
        "sha256": sha256(output),
        "bytes": output.stat().st_size,
        "files": len(expected),
    }


def renderer(scratch: Path, catalog: Catalog) -> Path:
    if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
        raise RuntimeError("The archive's pinned renderer is for Apple Silicon macOS")
    directory = scratch / "tools"
    directory.mkdir(exist_ok=True)
    archive = directory / "unmined.zip"
    versions = json.loads((REPO / "packages/version-catalog/src/catalog.json").read_text())
    version = next(v["value"] for v in versions["entries"] if v["name"] == "unmined/unmined-cli")
    executable = directory / "unmined" / f"unmined-cli_{version}-dev_osx-arm64/unmined-cli"
    if not archive.exists():
        subprocess.run(
            ["curl", "-fLsS", "-A", "StormWorldArchive/1.0", catalog["rendererUrl"], "-o", str(archive)],
            check=True,
        )
    if sha256(archive) != catalog["rendererSha256"]:
        raise RuntimeError("Renderer checksum mismatch")
    if not executable.exists():
        with zipfile.ZipFile(archive) as zipped:
            for info in zipped.infolist():
                safe_parts(info.filename)
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise ValueError("Symlink in renderer package")
            zipped.extractall(directory / "unmined")
        executable.chmod(0o755)
    return executable


def extract_preview(source: Path, world: WorldFiles, work: Path) -> list[PreviewArea]:
    extracted = work / "world"
    extracted.mkdir()
    with zipfile.ZipFile(source / world["file"]) as original:
        metadata, spawn = level_metadata(original.read(f"{world['root']}/level.dat"))
        areas = preview_areas(spawn)
        members = [(info, retained_path(info, world["root"])) for info in original.infolist()]
        selected = [(info, path) for info, path in members if path is not None and areas[0].includes(path)]
        require_space(work, sum(info.file_size for info, _ in selected))
        (extracted / "level.dat").write_bytes(metadata)
        for info, path in selected:
            target = extracted / path
            target.parent.mkdir(parents=True, exist_ok=True)
            with original.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, CHUNK)
        if not selected:
            raise ValueError("The preview area contains no terrain regions")
    return areas


def render_preview(executable: Path, work: Path, area: PreviewArea, workers: int) -> Path:
    output = work / f"{area.kind}.png"
    command = [
        str(executable),
        "image",
        "render",
        f"--world={work / 'world'}",
        f"--output={output}",
        f"--area={area.argument}",
        f"--zoom={area.zoom}",
        f"--chunkprocessors={workers}",
        "--blockrender=false",
        "--shadows=false",
        "--trim",
    ]
    started = time.monotonic()
    log = work / f"{area.kind}.log"
    with log.open("w") as stream:
        process = subprocess.Popen(
            command,
            cwd=work,
            stdout=stream,
            stderr=subprocess.STDOUT,
            env={**os.environ, "DOTNET_PROCESSOR_COUNT": str(workers)},
            preexec_fn=lambda: os.nice(10),
        )
        try:
            while process.poll() is None:
                require_space(work)
                if time.monotonic() - started > 600:
                    raise TimeoutError(f"Preview exceeded ten minutes; see {log}")
                time.sleep(0.5)
            if process.returncode != 0:
                raise RuntimeError(f"Preview failed ({process.returncode}); see {log}")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    width, height = png_dimensions(output)
    if not (0 < width <= area.pixels and 0 < height <= area.pixels):
        raise ValueError("Preview exceeds its bounded image size")
    print(f"Rendered {area.kind} in {time.monotonic() - started:.1f}s ({width} x {height})", flush=True)
    return output


def aws(profile: str, args: list[str], *, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["aws", "--profile", profile, "--endpoint-url", ENDPOINT, *args],
        env=AWS_ENV,
        check=True,
        capture_output=capture_output,
        text=True,
    )


def verify_url(key: str, size: int | None = None) -> None:
    url = f"{ORIGIN}/{key}"
    headers = {"User-Agent": "StormWorldArchive/1.0"}
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=headers), timeout=60) as response:
        if response.status != 200:
            raise RuntimeError(f"Public asset failed: {url} ({response.status})")
    if size is not None:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers={**headers, "Range": "bytes=0-15"}), timeout=60
        ) as response:
            if (
                response.status != 206
                or response.headers["Content-Range"] != f"bytes 0-{min(size, 16) - 1}/{size}"
                or len(response.read(17)) != min(size, 16)
            ):
                raise RuntimeError(f"Download does not support byte ranges: {url}")


def upload_download(profile: str, path: Path, key: str, digest: str, *, attachment: bool = True) -> None:
    # A fresh scratch directory must not replace an immutable URL with new bytes.
    listed = aws(
        profile,
        ["s3api", "list-objects-v2", "--bucket", BUCKET, "--prefix", key],
        capture_output=True,
    )
    existing = json.loads(listed.stdout).get("Contents", [])
    if any(entry["Key"] == key for entry in existing):
        verify_checkpoint(profile, f"{ORIGIN}/{key}", path.stat().st_size, digest)
    aws(
        profile,
        [
            "s3",
            "cp",
            str(path),
            f"s3://{BUCKET}/{key}",
            "--only-show-errors",
            "--cache-control",
            "public,max-age=31536000,immutable",
            "--metadata",
            f"sha256={digest}",
            "--content-disposition",
            f'attachment; filename="{path.name}"' if attachment else "inline",
        ],
    )
    command = [
        "aws",
        "--profile",
        profile,
        "--endpoint-url",
        ENDPOINT,
        "s3",
        "cp",
        f"s3://{BUCKET}/{key}",
        "-",
        "--only-show-errors",
    ]
    with subprocess.Popen(command, env=AWS_ENV, stdout=subprocess.PIPE) as process:
        if process.stdout is None:
            raise RuntimeError("S3 readback pipe is missing")
        remote = stream_sha256(process.stdout)
        if process.wait() != 0 or remote != digest:
            raise RuntimeError(f"S3 download readback mismatch: {key}")
    # Publication certifies bytes through S3 and checks public availability.
    # Public range support is a distinct serving-layer acceptance check.
    verify_url(key)


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(".partial")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def verify_checkpoint(profile: str, url: str, size: int, digest: str) -> None:
    prefix = f"{ORIGIN}/"
    if not url.startswith(prefix):
        raise ValueError("Checkpoint URL belongs to another origin")
    result = aws(
        profile,
        ["s3api", "head-object", "--bucket", BUCKET, "--key", url.removeprefix(prefix)],
        capture_output=True,
    )
    remote = json.loads(result.stdout)
    # SeaweedFS preserves HTTP header casing in S3 metadata keys.
    hashes = [value for name, value in remote.get("Metadata", {}).items() if name.casefold() == "sha256"]
    if remote["ContentLength"] != size or hashes != [digest]:
        raise RuntimeError(f"Checkpoint object changed: {url}; inspect storage before restoring uploads")


def download_size(size: int) -> str:
    return f"{size / GIB:.2f} GiB" if size >= GIB else f"{size / CHUNK:.1f} MiB"


def run(args: argparse.Namespace) -> None:
    catalog = load_catalog()
    worlds = [world for world in catalog["worlds"] if not args.only or world["id"] == args.only]
    source, scratch = args.source.resolve(), args.scratch.resolve()
    if scratch.is_relative_to(source) or scratch.is_relative_to(REPO) or source.is_relative_to(scratch):
        raise ValueError("Scratch must be outside the repository and source directory")
    if args.dry_run:
        for world in worlds:
            with zipfile.ZipFile(source / world["file"]) as zipped:
                _, spawn = level_metadata(zipped.read(f"{world['root']}/level.dat"))
                print(f"{world['id']}: spawn {spawn}; previews 2048² and 512² blocks")
        print("One world at a time; at most two rendering workers; 15 GiB disk reserve.")
        return
    scratch.mkdir(parents=True, exist_ok=True)
    marker = scratch / ".archive-scratch-owner"
    ownership = {"release": catalog["release"], "source": str(source)}
    if marker.exists() and json.loads(marker.read_text()) != ownership:
        raise ValueError("Scratch belongs to another archive release/source")
    write_json(marker, ownership)
    require_space(scratch)
    aws(args.profile, ["s3api", "head-bucket", "--bucket", BUCKET])
    executable = renderer(scratch, catalog)
    state_path = scratch / "published.json"
    state: Publication = (
        json.loads(state_path.read_text())
        if state_path.exists()
        else {"release": catalog["release"], "downloads": {}, "worlds": {}, "schematics": {}}
    )
    if state["release"] != catalog["release"] or "downloads" not in state:
        raise ValueError("Publication checkpoint is from a different pipeline/release")
    prefix = f"world-archive/{catalog['release']}"
    for world in sorted(worlds, key=lambda w: (source / w["file"]).stat().st_size):
        download = state["downloads"].get(world["id"])
        if download is not None and sha256(source / world["file"]) != download["sourceSha256"]:
            raise ValueError("Published source changed; use a new release")
        if download is not None:
            verify_checkpoint(args.profile, download["download"], download["bytes"], download["sha256"])
        if world["id"] in state["worlds"]:
            for image in state["worlds"][world["id"]]["previews"]:
                verify_checkpoint(args.profile, image["url"], image["bytes"], image["sha256"])
            continue
        work = scratch / world["id"]
        if work.exists():
            raise RuntimeError(f"Unfinished scratch exists: {work}; inspect its logs before retrying")
        work.mkdir()
        print(f"Preparing {world['id']} ({shutil.disk_usage(scratch).free / GIB:.1f} GiB free)", flush=True)
        if download is None:
            cleaned, metadata = prepare(source, world, work)
            key = f"{prefix}/downloads/{cleaned.name}"
            upload_download(args.profile, cleaned, key, metadata["sha256"])
            published_download: PublishedDownload = {**metadata, "download": f"{ORIGIN}/{key}"}
            download = published_download
            state["downloads"][world["id"]] = download
            write_json(state_path, state)
            cleaned.unlink()
        areas = extract_preview(source, world, work)
        images: list[PublishedPreview] = []
        for area in areas:
            path = render_preview(executable, work, area, args.workers)
            digest = sha256(path)
            key = f"{prefix}/previews/{world['id']}/{path.name}"
            upload_download(args.profile, path, key, digest, attachment=False)
            width, height = png_dimensions(path)
            images.append(
                {
                    "kind": area.kind,
                    "url": f"{ORIGIN}/{key}",
                    "sha256": digest,
                    "bytes": path.stat().st_size,
                    "width": width,
                    "height": height,
                    "bounds": [area.x, area.z, area.blocks, area.blocks],
                }
            )
        published_world: PublishedWorld = {**download, "previews": images}
        state["worlds"][world["id"]] = published_world
        write_json(state_path, state)
        shutil.rmtree(work)
        print(f"Published {world['id']}; scratch removed", flush=True)
    for schematic in catalog["schematics"]:
        if args.only:
            break
        path = source / schematic["file"]
        digest = sha256(path)
        if schematic["file"] in state["schematics"]:
            previous = state["schematics"][schematic["file"]]
            if previous["sha256"] != digest:
                raise ValueError("Published schematic changed; use a new release")
            verify_checkpoint(args.profile, previous["download"], previous["bytes"], digest)
            continue
        key = f"{prefix}/downloads/{path.name}"
        upload_download(args.profile, path, key, digest)
        state["schematics"][schematic["file"]] = {
            "download": f"{ORIGIN}/{key}",
            "bytes": path.stat().st_size,
            "sha256": digest,
        }
        write_json(state_path, state)
    if not args.only:
        checksums = scratch / "checksums.json"
        write_json(
            checksums, {"release": state["release"], "worlds": state["worlds"], "schematics": state["schematics"]}
        )
        aws(
            args.profile,
            [
                "s3",
                "cp",
                str(checksums),
                f"s3://{BUCKET}/{prefix}/checksums.json",
                "--only-show-errors",
                "--content-type",
                "application/json",
                "--cache-control",
                "no-cache",
            ],
        )
        verify_url(f"{prefix}/checksums.json")
    print(f"Downloads: {ORIGIN}/world_downloads/", flush=True)


def document(state_path: Path) -> None:
    catalog = load_catalog()
    state: Publication = json.loads(state_path.read_text(encoding="utf-8"))
    if (
        state["release"] != catalog["release"]
        or set(state["worlds"]) != {w["id"] for w in catalog["worlds"]}
        or set(state["schematics"]) != {s["file"] for s in catalog["schematics"]}
    ):
        raise ValueError("Refusing to document an incomplete/different archive release")
    lines = [
        "---",
        "title: World Downloads",
        "description: Explore and download the preserved worlds and builds of The Storm.",
        "---",
        "",
        "Browse previews of the preserved worlds, or download a copy to play locally.",
        "",
        "## Play a world",
        "",
        "1. Download and extract its ZIP. Each ZIP contains one world folder with `level.dat` directly inside.",
        "2. Put that folder in your Minecraft Java Edition `saves` directory "
        "(`.minecraft/saves` on Windows/Linux, or `~/Library/Application Support/minecraft/saves` on macOS).",
        "3. Start the Minecraft version listed below and select the world in Singleplayer.",
        "",
        "The downloads preserve their original formats, builds, inventories, and historical player saves. "
        "Minecraft chooses player state by identity; server player files remain included.",
        "",
        "Server plugins and custom terrain generators are not included. Existing builds are preserved; "
        "new terrain and server features can differ in single-player.",
        "",
        "The top-down images show selected areas around spawn, rather than complete maps. "
        "Click an image to see it at full size. "
        "Keep a backup before opening an old download in a newer Minecraft version.",
        "",
        "## Archived worlds",
        "",
    ]
    for world in catalog["worlds"]:
        entry = state["worlds"][world["id"]]
        lines += [
            f"### {world['title']}",
            "",
            world["description"],
            "",
            f"**Snapshot:** {world['date']} · **Minecraft:** {world['minecraft']} · "
            f"**Download:** {download_size(entry['bytes'])}",
            "",
            f"[Download ZIP]({entry['download']})",
            "",
            f"Credit: {world['credit']}.",
            "",
            '<div class="archive-previews">',
        ]
        for preview in entry["previews"]:
            label = "Around spawn" if preview["kind"] == "overview" else "Close-up"
            lines += [
                f'<figure><a href="{preview["url"]}"><img src="{preview["url"]}" '
                f'width="{preview["width"]}" height="{preview["height"]}" loading="lazy" '
                f'alt="{world["title"]}: {label.lower()} from above" /></a>',
                f"<figcaption>{label} · {preview['bounds'][2]:,}-block selection · north is up</figcaption></figure>",
                "",
            ]
        lines += [
            "</div>",
            "",
            "<details>",
            "<summary>SHA-256 checksum</summary>",
            "",
            "```text",
            entry["sha256"],
            "```",
            "",
            "</details>",
            "",
        ]
    lines += [
        "## Recovered plot schematics",
        "",
        "These builds are by WinterSolstice8 / BlueAsterismSolstice. Import them with WorldEdit; "
        "they are schematic files, not single-player save folders. "
        "Blue Valkyrie and Spider Queen are explicitly documented as Storm builds; "
        "the other six are attributed by their plot format and publication dates.",
        "",
        "| Build | Download |",
        "| --- | --- |",
    ]
    for schematic in catalog["schematics"]:
        entry = state["schematics"][schematic["file"]]
        lines += [f"| {schematic['title']} | [Schematic ({entry['bytes'] / 1024:.0f} KiB)]({entry['download']}) |"]
    lines += ["", f"[Checksums for every download]({ORIGIN}/world-archive/{catalog['release']}/checksums.json)", ""]
    (PACKAGE / "src/content/docs/world_downloads.md").write_text("\n".join(lines), encoding="utf-8")
    write_json(
        PACKAGE / "archive/published.json",
        {"release": state["release"], "worlds": state["worlds"], "schematics": state["schematics"]},
    )


def verify(state_path: Path) -> None:
    state: Publication = json.loads(state_path.read_text(encoding="utf-8"))
    for entry in [*state["worlds"].values(), *state["schematics"].values()]:
        verify_url(entry["download"].removeprefix(f"{ORIGIN}/"), entry["bytes"])
    print("Public downloads support HTTP 200 and exact byte ranges.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    publish = subparsers.add_parser("run")
    publish.add_argument("--source", type=Path, required=True)
    publish.add_argument("--scratch", type=Path, required=True)
    publish.add_argument("--profile", default="seaweedfs")
    publish.add_argument("--workers", type=int, choices=(1, 2), default=2)
    publish.add_argument("--only", choices=[w["id"] for w in load_catalog()["worlds"]])
    publish.add_argument("--dry-run", action="store_true")
    docs = subparsers.add_parser("document")
    docs.add_argument("--state", type=Path, required=True)
    acceptance = subparsers.add_parser("verify")
    acceptance.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "run":
        run(args)
    elif args.command == "document":
        document(args.state)
    else:
        verify(args.state)


if __name__ == "__main__":
    main()
