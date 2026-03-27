"""End-to-end cooklang-for-obsidian release."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from ci.lib import buildkite, github

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig

SEPARATE_REPO = "shepherdjerred/cooklang-for-obsidian"
ARTIFACTS = ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"]
RELEASE_ARTIFACTS = ["main.js", "manifest.json", "styles.css"]


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("cooklang-release", help="Release cooklang-for-obsidian plugin")
    p.add_argument("--version", dest="cooklang_version", required=True, help="Release version")
    p.add_argument("--confirm", action="store_true", help="Confirm push to external repo")
    p.add_argument("--token", default=None, help="GitHub token (default: GH_TOKEN env or gh auth token)")
    p.set_defaults(func=run)


def _repo_root() -> Path:
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(result.stdout.strip())


def _get_token() -> str:
    token = os.environ.get("GH_TOKEN", "")
    if token:
        return token
    result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=False)
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    return ""


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    version: str = args.cooklang_version

    token = args.token or _get_token()
    if not token and not dry_run:
        print("Error: GH_TOKEN or `gh auth token` required", file=sys.stderr)
        sys.exit(1)

    repo_root = _repo_root()
    pkg_dir = repo_root / "packages" / "cooklang-for-obsidian"
    staging_dir = Path(os.environ.get("MONOREPO_CI_RUN_DIR", "/tmp/monorepo-ci")) / "artifacts"
    staging_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Build
    print(f"\n--- Building cooklang-for-obsidian v{version} ---", flush=True)
    if dry_run:
        print(f"  [DRY RUN] Update manifest.json/package.json version to {version}", flush=True)
        print("  [DRY RUN] bun install && bun run build", flush=True)
    else:
        for filename in ("manifest.json", "package.json"):
            filepath = pkg_dir / filename
            with open(filepath) as f:
                data = json.load(f)
            data["version"] = version
            with open(filepath, "w") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
        subprocess.run(["bun", "install"], cwd=str(repo_root), check=True)
        subprocess.run(["bun", "run", "build"], cwd=str(pkg_dir), check=True)

    # Stage artifacts
    for name in ARTIFACTS:
        src = pkg_dir / name
        if src.exists() and not dry_run:
            import shutil

            shutil.copy2(str(src), str(staging_dir / name))
            buildkite.artifact_upload(str(staging_dir / name))

    # Step 2: Push to separate repo
    print(f"\n--- Pushing to {SEPARATE_REPO} ---", flush=True)
    if not dry_run and not args.confirm:
        print("Error: use --confirm to push to external repo (or --dry-run to preview)", file=sys.stderr)
        sys.exit(1)
    for name in ARTIFACTS:
        if dry_run:
            print(f"  [DRY RUN] commit {name} to {SEPARATE_REPO}", flush=True)
        elif not (staging_dir / name).exists():
            print(f"  Warning: {name} not found in staging, skipping", flush=True)
        else:
            content = (staging_dir / name).read_text()
            msg = github.commit_file(name, content, f"chore: update {name} for v{version}", token, repo=SEPARATE_REPO)
            print(f"  {msg}", flush=True)

    # Step 3: Create release
    print(f"\n--- Creating release v{version} ---", flush=True)
    if dry_run:
        print(f"  [DRY RUN] gh release create {version} on {SEPARATE_REPO}", flush=True)
    else:
        asset_paths = [str(staging_dir / name) for name in RELEASE_ARTIFACTS]
        subprocess.run(
            [
                "gh",
                "release",
                "create",
                version,
                *asset_paths,
                "--repo",
                SEPARATE_REPO,
                "--title",
                f"v{version}",
                "--generate-notes",
            ],
            env={**os.environ, "GH_TOKEN": token},
            check=True,
        )

    print(f"\nCooklang-for-obsidian v{version} released", flush=True)
