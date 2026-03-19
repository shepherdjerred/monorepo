"""End-to-end clauderon release (native build by default)."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig

LINUX_TARGETS = [
    {"target": "x86_64-unknown-linux-gnu", "filename": "clauderon-linux-x86_64"},
    {"target": "aarch64-unknown-linux-gnu", "filename": "clauderon-linux-arm64"},
]


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("clauderon-release", help="Build and release clauderon")
    p.add_argument("--version", dest="clauderon_version", required=True, help="Release version")
    p.add_argument("--all-targets", action="store_true", help="Cross-compile for all Linux targets (requires cross)")
    p.set_defaults(func=run)


def _repo_root() -> Path:
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(result.stdout.strip())


def _get_token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        return token
    result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=False)
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    return ""


def _native_target() -> tuple[str, str]:
    machine = platform.machine().lower()
    system = platform.system().lower()
    if system == "darwin":
        triple = f"{'aarch64' if machine == 'arm64' else 'x86_64'}-apple-darwin"
        filename = f"clauderon-macos-{'arm64' if machine == 'arm64' else 'x86_64'}"
    else:
        triple = f"{'aarch64' if machine == 'aarch64' else 'x86_64'}-unknown-linux-gnu"
        filename = f"clauderon-linux-{'arm64' if machine == 'aarch64' else 'x86_64'}"
    return triple, filename


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    version: str = args.clauderon_version
    repo_root = _repo_root()
    cargo_toml = str(repo_root / "packages/clauderon/Cargo.toml")
    staging_dir = Path(os.environ.get("MONOREPO_CI_RUN_DIR", "/tmp/monorepo-ci")) / "artifacts"
    staging_dir.mkdir(parents=True, exist_ok=True)

    token = _get_token()
    if not token and not dry_run:
        print("Error: GITHUB_TOKEN or `gh auth token` required", file=sys.stderr)
        sys.exit(1)

    # Determine build targets
    if args.all_targets:
        if not dry_run and not shutil.which("cross"):
            print("Error: `cross` (cross-rs) not found. Install with: cargo install cross", file=sys.stderr)
            sys.exit(1)
        targets = LINUX_TARGETS
        build_cmd = "cross"
    else:
        triple, filename = _native_target()
        targets = [{"target": triple, "filename": filename}]
        build_cmd = "cargo"

    # Build
    built_files: list[str] = []
    for t in targets:
        print(f"\n--- Building clauderon v{version} for {t['target']} ---", flush=True)
        if dry_run:
            print(f"  [DRY RUN] {build_cmd} build --release --target {t['target']}", flush=True)
            built_files.append(t["filename"])
            continue
        subprocess.run(
            [build_cmd, "build", "--release", "--target", t["target"], "--manifest-path", cargo_toml],
            check=True,
        )
        src = repo_root / f"packages/clauderon/target/{t['target']}/release/clauderon"
        dst = staging_dir / t["filename"]
        shutil.copy2(str(src), str(dst))
        built_files.append(t["filename"])
        print(f"  Built {t['filename']}", flush=True)

    # Ensure GitHub release exists, then upload
    tag = f"clauderon-v{version}"
    print(f"\n--- Uploading to GitHub release {tag} ---", flush=True)
    if not dry_run:
        # Create the release if it doesn't already exist
        subprocess.run(
            [
                "gh", "release", "create", tag,
                "--repo", "shepherdjerred/monorepo",
                "--title", tag,
                "--notes", f"Clauderon v{version}",
            ],
            env={**os.environ, "GH_TOKEN": token},
            check=False,  # ignore error if release already exists
        )
    else:
        print(f"  [DRY RUN] gh release create {tag} (if not exists)", flush=True)

    for filename in built_files:
        if dry_run:
            print(f"  [DRY RUN] gh release upload {tag} {filename}", flush=True)
        else:
            subprocess.run(
                [
                    "gh",
                    "release",
                    "upload",
                    tag,
                    str(staging_dir / filename),
                    "--repo",
                    "shepherdjerred/monorepo",
                    "--clobber",
                ],
                env={**os.environ, "GH_TOKEN": token},
                check=True,
            )
            print(f"  Uploaded {filename}", flush=True)

    print(f"\nClauderon v{version} release complete", flush=True)
