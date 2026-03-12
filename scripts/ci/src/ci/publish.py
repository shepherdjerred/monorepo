"""Publish container images and NPM packages.

Usage: uv run -m ci.publish [--packages PKG ...]

Pushes container images to GHCR via `bazel run --stamp //pkg:push`,
then publishes NPM packages via `bun publish`.

Args:
  --packages: Only publish specific packages (by Bazel package name, e.g. "birmel").
              If not specified, all packages are published.

Required env vars:
  GH_TOKEN - GitHub token for GHCR authentication
  NPM_TOKEN - NPM authentication token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from ci.lib import bazel, buildkite, ghcr, publish_npm
from ci.lib.config import ReleaseConfig


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


_REPO_ROOT = _repo_root()

# Map from push target to version key in versions.ts
PUSH_TARGET_TO_VERSION_KEY = {
    "//packages/birmel:image_push": "shepherdjerred/birmel",
    "//packages/sentinel:image_push": "shepherdjerred/sentinel",
    "//packages/tasknotes-server:image_push": "shepherdjerred/tasknotes-server",
    "//packages/scout-for-lol:image_push": "shepherdjerred/scout-for-lol/beta",
    "//packages/discord-plays-pokemon:image_push": "shepherdjerred/discord-plays-pokemon",
    "//packages/starlight-karma-bot:image_push": "shepherdjerred/starlight-karma-bot/beta",
    "//packages/better-skill-capped/fetcher:image_push": "shepherdjerred/better-skill-capped-fetcher",
    "//tools/oci:obsidian_headless_push": "shepherdjerred/obsidian-headless",
}

DIGESTS_FILE = "/tmp/image-digests.json"

# Bazel push targets for container images.
# bun_service_image(name="image", ...) creates a target named "image_push".
PUSH_TARGETS = [
    "//packages/birmel:image_push",
    "//packages/sentinel:image_push",
    "//packages/tasknotes-server:image_push",
    "//packages/scout-for-lol:image_push",
    "//packages/discord-plays-pokemon:image_push",
    "//packages/starlight-karma-bot:image_push",
    "//packages/better-skill-capped/fetcher:image_push",
    "//tools/oci:obsidian_headless_push",
]

# NPM packages to publish
NPM_PACKAGES = [
    str(_REPO_ROOT / "packages/bun-decompile"),
    str(_REPO_ROOT / "packages/astro-opengraph-images"),
    str(_REPO_ROOT / "packages/webring"),
    str(_REPO_ROOT / "packages/homelab/src/helm-types"),
]


def _filter_by_packages(items: list[str], packages: list[str] | None) -> list[str]:
    """Filter a list of Bazel targets to only include those matching package names."""
    if not packages:
        return items
    return [t for t in items if any(f"packages/{p}" in t for p in packages)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish container images and NPM packages")
    parser.add_argument("--packages", nargs="+", default=None, help="Only publish specific packages")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping publish", flush=True)
        return

    # Validate required credentials on main
    gh_token = os.environ.get("GH_TOKEN", "")
    if not gh_token:
        print("GH_TOKEN not set on main branch, failing", flush=True)
        sys.exit(1)

    if args.packages:
        print(f"Filtering to packages: {', '.join(args.packages)}", flush=True)

    errors: list[str] = []

    # --- Container image publishing (always on main) ---
    digests: dict[str, str] = {}
    push_targets = _filter_by_packages(PUSH_TARGETS, args.packages)
    print("\n--- Publish container images to GHCR ---", flush=True)
    ghcr.login(gh_token)
    for target in push_targets:
        try:
            print(f"\nPushing {target}", flush=True)
            output = bazel.run_capture(target, stamp=True, embed_label=config.version)
            version_key = PUSH_TARGET_TO_VERSION_KEY.get(target)
            if version_key:
                versioned = ghcr.format_version_with_digest(config.version, output)
                digests[version_key] = versioned
                print(f"  Digest: {versioned}", flush=True)
        except subprocess.CalledProcessError as e:
            stderr = e.stderr or "(no stderr captured)"
            errors.append(f"Failed to push {target}: {e}\n  stderr: {stderr}")
        except Exception as e:
            errors.append(f"Failed to push {target}: {e}")

    # Write digests for version_commit_back to consume (local file for same-step use)
    if digests:
        with open(DIGESTS_FILE, "w") as f:
            json.dump(digests, f, indent=2)
        print(f"\nWrote {len(digests)} digests to {DIGESTS_FILE}", flush=True)

    # Also store digests in Buildkite metadata for cross-step sharing
    if digests:
        buildkite.set_metadata("image_digests", json.dumps(digests))
        print("Stored digests in Buildkite metadata", flush=True)

    # --- NPM publishing (only when release-please created a release) ---
    release_created = buildkite.get_metadata("release_created", "false") == "true"
    npm_token = os.environ.get("NPM_TOKEN", "")
    npm_packages = NPM_PACKAGES if not args.packages else [
        p for p in NPM_PACKAGES
        if any(pkg in p for pkg in args.packages)
    ]
    if not release_created:
        print("\nNo release created, skipping NPM publish", flush=True)
    elif npm_token:
        print("\n--- Publish NPM packages ---", flush=True)
        for pkg_dir in npm_packages:
            try:
                print(f"\nPublishing {pkg_dir}", flush=True)
                publish_npm.publish(pkg_dir, npm_token)
            except Exception as e:
                errors.append(f"Failed to publish {pkg_dir}: {e}")
    else:
        print("NPM_TOKEN not set, skipping NPM publish", flush=True)

    if errors:
        print(f"\n--- {len(errors)} error(s) during publish ---", flush=True)
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}", flush=True)
        summary = "\n".join(f"- {e}" for e in errors)
        buildkite.annotate(f"**Publish errors:**\n{summary}", style="error", context="publish")
        sys.exit(1)

    print("\nAll publishes completed successfully", flush=True)


if __name__ == "__main__":
    main()
