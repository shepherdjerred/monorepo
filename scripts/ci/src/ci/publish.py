"""Publish container images and NPM packages.

Usage: uv run -m ci.publish [--packages PKG ...]

Pushes container images to GHCR via `bazel run --stamp //pkg:push`,
then publishes NPM packages via `bun publish`.

Args:
  --packages: Only publish specific packages (by Bazel package name, e.g. "birmel").
              If not specified, all packages are published.

Required env vars:
  GHCR_USERNAME, GHCR_PASSWORD - GitHub Container Registry auth
  NPM_TOKEN - NPM authentication token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

from ci.lib import bazel, ghcr, npm
from ci.lib.config import ReleaseConfig

# Map from push target to version key in versions.ts
PUSH_TARGET_TO_VERSION_KEY = {
    "//packages/birmel:image_push": "shepherdjerred/birmel",
    "//packages/sentinel:image_push": "shepherdjerred/sentinel",
    "//packages/tasknotes-server:image_push": "shepherdjerred/tasknotes-server",
    "//packages/scout-for-lol:image_push": "shepherdjerred/scout-for-lol/beta",
    "//packages/discord-plays-pokemon:image_push": "shepherdjerred/discord-plays-pokemon",
    "//packages/starlight-karma-bot:image_push": "shepherdjerred/starlight-karma-bot/beta",
    "//packages/better-skill-capped/fetcher:image_push": "shepherdjerred/better-skill-capped-fetcher",
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
]

# NPM packages to publish
NPM_PACKAGES = [
    "packages/bun-decompile",
    "packages/astro-opengraph-images",
    "packages/webring",
    "packages/homelab/src/helm-types",
]

# Docker-built images (not using Bazel oci_push)
DOCKER_IMAGES = [
    {
        "name": "obsidian-headless",
        "dockerfile": "tools/oci/obsidian-headless/Dockerfile",
        "context": "tools/oci/obsidian-headless",
        "repository": "ghcr.io/shepherdjerred/obsidian-headless",
        "version_key": "shepherdjerred/obsidian-headless",
    },
]


def _get_metadata(key: str, default: str = "false") -> str:
    """Get Buildkite metadata. Returns default if buildkite-agent is not available."""
    if shutil.which("buildkite-agent") is None:
        print(f"buildkite-agent not found, using default {key}={default}", flush=True)
        return default
    result = subprocess.run(
        ["buildkite-agent", "meta-data", "get", key, "--default", default],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else default


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

    if args.packages:
        print(f"Filtering to packages: {', '.join(args.packages)}", flush=True)

    errors: list[str] = []

    # --- Container image publishing (always on main) ---
    digests: dict[str, str] = {}
    ghcr_username = os.environ.get("GHCR_USERNAME", "")
    ghcr_password = os.environ.get("GHCR_PASSWORD", "")
    push_targets = _filter_by_packages(PUSH_TARGETS, args.packages)
    if ghcr_username and ghcr_password:
        print("\n--- Publish container images to GHCR ---", flush=True)
        ghcr.login(ghcr_username, ghcr_password)
        for target in push_targets:
            try:
                print(f"\nPushing {target}", flush=True)
                output = bazel.run_capture(target, stamp=True, embed_label=config.version)
                version_key = PUSH_TARGET_TO_VERSION_KEY.get(target)
                if version_key:
                    versioned = ghcr.format_version_with_digest(config.version, output)
                    digests[version_key] = versioned
                    print(f"  Digest: {versioned}", flush=True)
            except Exception:
                errors.append(f"Failed to push {target}")
    else:
        print("GHCR credentials not set, skipping container publish", flush=True)

    # --- Docker-built images ---
    docker_images = DOCKER_IMAGES if not args.packages else [
        img for img in DOCKER_IMAGES
        if any(p in img["name"] for p in args.packages)
    ]
    if ghcr_username and ghcr_password:
        for img in docker_images:
            try:
                tag = f"{img['repository']}:{config.version}"
                print(f"\nBuilding Docker image {img['name']} ({tag})", flush=True)
                subprocess.run(
                    ["docker", "build", "-t", tag, "-f", img["dockerfile"], img["context"]],
                    check=True,
                )
                print(f"Pushing {tag}", flush=True)
                result = subprocess.run(
                    ["docker", "push", tag],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                version_key = img.get("version_key")
                if version_key:
                    # Try to get digest from push output
                    versioned = ghcr.format_version_with_digest(config.version, result.stdout)
                    digests[version_key] = versioned
                    print(f"  Digest: {versioned}", flush=True)
            except Exception:
                errors.append(f"Failed to build/push Docker image {img['name']}")

    # Write digests for version_commit_back to consume (local file for same-step use)
    if digests:
        with open(DIGESTS_FILE, "w") as f:
            json.dump(digests, f, indent=2)
        print(f"\nWrote {len(digests)} digests to {DIGESTS_FILE}", flush=True)

    # Also store digests in Buildkite metadata for cross-step sharing
    if digests and shutil.which("buildkite-agent") is not None:
        subprocess.run(
            ["buildkite-agent", "meta-data", "set", "image_digests", json.dumps(digests)],
            check=False,
        )
        print("Stored digests in Buildkite metadata", flush=True)

    # --- NPM publishing (only when release-please created a release) ---
    release_created = _get_metadata("release_created") == "true"
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
                npm.publish(pkg_dir, npm_token)
            except Exception as e:
                errors.append(f"Failed to publish {pkg_dir}: {e}")
    else:
        print("NPM_TOKEN not set, skipping NPM publish", flush=True)

    if errors:
        print(f"\n--- {len(errors)} error(s) during publish ---", flush=True)
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}", flush=True)
        sys.exit(1)

    print("\nAll publishes completed successfully", flush=True)


if __name__ == "__main__":
    main()
