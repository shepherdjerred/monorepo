"""Commit updated image digests back to versions.ts.

Usage: uv run -m ci.version_commit_back

After container images are published, this script updates
packages/homelab/src/cdk8s/src/versions.ts with the new image
digests and creates a PR with auto-merge.

Required env vars:
  GH_TOKEN - GitHub token with repo write access
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from ci.lib.config import ReleaseConfig

REPO = "shepherdjerred/monorepo"
VERSIONS_FILE = "packages/homelab/src/cdk8s/src/versions.ts"
DIGESTS_FILE = "/tmp/image-digests.json"

# Version keys to update (maps to image names in versions.ts)
VERSION_KEYS = [
    "shepherdjerred/homelab",
    "shepherdjerred/dependency-summary",
    "shepherdjerred/dns-audit",
    "shepherdjerred/caddy-s3proxy",
    "shepherdjerred/sentinel",
    "shepherdjerred/birmel",
    "shepherdjerred/tasknotes-server",
    "shepherdjerred/obsidian-headless",
    "shepherdjerred/starlight-karma-bot/beta",
    "shepherdjerred/better-skill-capped-fetcher",
    "shepherdjerred/discord-plays-pokemon",
    "shepherdjerred/scout-for-lol/beta",
]


def _get_metadata(key: str, default: str = "") -> str:
    """Get Buildkite metadata. Returns default if unavailable."""
    if shutil.which("buildkite-agent") is None:
        return default
    result = subprocess.run(
        ["buildkite-agent", "meta-data", "get", key, "--default", default],
        capture_output=True, text=True, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else default


def _load_digests() -> dict[str, str]:
    """Load digest maps from publish + homelab release steps via Buildkite metadata.

    Falls back to local /tmp files if metadata isn't available (e.g. local testing).
    """
    digests: dict[str, str] = {}

    # Try Buildkite metadata first (cross-step sharing)
    image_digests_json = _get_metadata("image_digests")
    if image_digests_json:
        digests.update(json.loads(image_digests_json))
        print(f"Loaded {len(digests)} digests from Buildkite metadata (image_digests)", flush=True)

    infra_digests_json = _get_metadata("infra_digests")
    if infra_digests_json:
        infra = json.loads(infra_digests_json)
        digests.update(infra)
        print(f"Loaded {len(infra)} digests from Buildkite metadata (infra_digests)", flush=True)

    # Fall back to local files (same-step or local testing)
    if not digests:
        path = Path(DIGESTS_FILE)
        if path.exists():
            with open(path) as f:
                digests = json.load(f)
            print(f"Loaded {len(digests)} digests from {DIGESTS_FILE}", flush=True)
        else:
            print("No digests found, using plain versions", flush=True)

    return digests


def main() -> None:
    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping version commit-back", flush=True)
        return

    gh_token = os.environ.get("GH_TOKEN", "")
    if not gh_token:
        print("GH_TOKEN not set, skipping version commit-back", flush=True)
        return

    branch_name = f"chore/update-versions-{int(time.time())}"

    # Load digest-pinned versions from publish step
    digests = _load_digests()

    print(f"Updating versions to {config.version}", flush=True)

    env = {**os.environ, "GH_TOKEN": gh_token}

    # Build sed commands to update each version key.
    # Use digest-pinned version if available, otherwise plain version.
    sed_commands = ""
    for key in VERSION_KEYS:
        escaped_key = key.replace("/", r"\/")
        version_value = digests.get(key, config.version)
        # Escape @ and / in the version value for sed
        escaped_value = version_value.replace("/", r"\/")
        sed_commands += f's/"{escaped_key}": "[^"]*"/"{escaped_key}": "{escaped_value}"/g; '

    script = f"""
set -euo pipefail
git clone --branch=main --depth=1 https://x-access-token:$GH_TOKEN@github.com/{REPO}.git /tmp/monorepo-versions
cd /tmp/monorepo-versions
git config user.name "ci-bot"
git config user.email "ci@localhost"
sed -i '{sed_commands}' {VERSIONS_FILE}
if git diff --quiet; then
    echo "NO_CHANGES"
    exit 0
fi
git checkout -b {branch_name}
git add {VERSIONS_FILE}
git commit -m "chore: update deployed image versions [skip ci]"
git push --set-upstream origin {branch_name}
gh pr create --title "chore: update deployed image versions [skip ci]" \
    --body "Automated version update from CI pipeline. Updates image digests in versions.ts to match the latest published images."
gh pr merge --auto --merge
rm -rf /tmp/monorepo-versions
"""

    result = subprocess.run(["bash", "-c", script], env=env, check=False)
    if result.returncode != 0:
        print(f"Version commit-back failed (exit code {result.returncode})", flush=True)
        sys.exit(1)

    print("Version commit-back completed", flush=True)


if __name__ == "__main__":
    main()
