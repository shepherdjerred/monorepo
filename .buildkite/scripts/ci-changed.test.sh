#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SELECTOR="${SCRIPT_DIR}/ci-changed.sh"
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.email ci-selector@example.invalid
git -C "$FIXTURE" config user.name "CI selector test"
mkdir -p "$FIXTURE/packages/docs" "$FIXTURE/packages/sjer.red/src" "$FIXTURE/.buildkite"
printf 'baseline\n' > "$FIXTURE/packages/docs/readme.md"
git -C "$FIXTURE" add packages/docs/readme.md
git -C "$FIXTURE" commit -qm baseline
BASE=$(git -C "$FIXTURE" rev-parse HEAD)

expect_status() {
  expected=$1
  lane=$2
  set +e
  (cd "$FIXTURE" && CI_CHANGED_BASE="$BASE" bash "$SELECTOR" "$lane")
  actual=$?
  set -e
  if [ "$actual" -ne "$expected" ]; then
    echo "${lane}: expected exit ${expected}, got ${actual}" >&2
    exit 1
  fi
}

# An unrelated docs change skips the heavyweight browser lane.
printf 'docs-only\n' >> "$FIXTURE/packages/docs/readme.md"
git -C "$FIXTURE" add packages/docs/readme.md
git -C "$FIXTURE" commit -qm docs-only
expect_status 78 playwright

# Artifact producers must run whenever their deploy consumer changes; otherwise
# the main sites lane would try to download an artifact that was never made.
mkdir -p "$FIXTURE/scripts"
printf 'deploy\n' > "$FIXTURE/scripts/deploy-site.ts"
git -C "$FIXTURE" add scripts/deploy-site.ts
git -C "$FIXTURE" commit -qm deploy-script
expect_status 0 playwright
expect_status 0 resume

# An owned source change selects the browser lane.
printf 'source\n' > "$FIXTURE/packages/sjer.red/src/index.ts"
git -C "$FIXTURE" add packages/sjer.red/src/index.ts
git -C "$FIXTURE" commit -qm site-source
expect_status 0 playwright

# Shared CI configuration is deliberately fail-open for every lane.
printf 'pipeline\n' > "$FIXTURE/.buildkite/pipeline.yml"
git -C "$FIXTURE" add .buildkite/pipeline.yml
git -C "$FIXTURE" commit -qm pipeline
expect_status 0 resume

# A typo cannot silently omit work.
expect_status 0 unknown-lane

echo "ci-changed selector tests passed"
