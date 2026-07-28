#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SELECTOR="${SCRIPT_DIR}/ci-changed.sh"
PREPARE_SELECTOR_BASE="${SCRIPT_DIR}/prepare-ci-changed-base.sh"
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
  # BUILDKITE is stripped so decision recording stays inert here: when this
  # test itself runs inside a CI job, the selector must not write fixture
  # decisions into the real build's meta-data.
  (cd "$FIXTURE" && CI_CHANGED_BASE="$BASE" env -u BUILDKITE bash "$SELECTOR" "$lane")
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

# The small preparation step ignores a passed build of the current commit,
# publishes the prior green commit once, and runtime selectors can consume the
# metadata without curl or jq in their own images.
CURRENT=$(git -C "$FIXTURE" rev-parse HEAD)
FAKE_BIN="$FIXTURE/fake-bin"
METADATA="$FIXTURE/ci-changed-base"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/curl" <<'EOF'
#!/bin/sh
printf '[{"commit":"%s"},{"commit":"%s"}]\n' "$FAKE_CURRENT" "$FAKE_BASE"
EOF
cat > "$FAKE_BIN/buildkite-agent" <<'EOF'
#!/bin/sh
if [ "$1" != "meta-data" ]; then
  echo "unexpected buildkite-agent command: $*" >&2
  exit 2
fi
case "$2" in
  set)
    printf '%s\n' "$4" > "$CI_CHANGED_METADATA_PATH"
    ;;
  get)
    cat "$CI_CHANGED_METADATA_PATH"
    ;;
  *)
    echo "unexpected metadata command: $2" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$FAKE_BIN/curl" "$FAKE_BIN/buildkite-agent"
(
  cd "$FIXTURE"
  PATH="$FAKE_BIN:$PATH" \
    FAKE_BASE="$BASE" \
    FAKE_CURRENT="$CURRENT" \
    CI_CHANGED_METADATA_PATH="$METADATA" \
    BUILDKITE_API_TOKEN=test-token \
    BUILDKITE_COMMIT="$CURRENT" \
    bash "$PREPARE_SELECTOR_BASE"
)
if [ "$(cat "$METADATA")" != "$BASE" ]; then
  echo "prepare-ci-changed-base did not select the prior green commit" >&2
  exit 1
fi
set +e
(
  cd "$FIXTURE"
  PATH="$FAKE_BIN:$PATH" \
    CI_CHANGED_METADATA_PATH="$METADATA" \
    bash "$SELECTOR" playwright
)
metadata_status=$?
set -e
if [ "$metadata_status" -ne 78 ]; then
  echo "metadata-backed selector expected exit 78, got ${metadata_status}" >&2
  exit 1
fi

# Artifact producers must run whenever their deploy consumer changes; otherwise
# the main sites lane would try to download an artifact that was never made.
mkdir -p "$FIXTURE/scripts"
printf 'deploy\n' > "$FIXTURE/scripts/deploy-site.ts"
git -C "$FIXTURE" add scripts/deploy-site.ts
git -C "$FIXTURE" commit -qm deploy-script
expect_status 0 playwright
expect_status 0 resume

# Scout's deploy and reconciliation lanes include the workspace
# packages they build transitively, not only paths under packages/scout-for-lol.
BASE=$(git -C "$FIXTURE" rev-parse HEAD)
mkdir -p "$FIXTURE/packages/llm-models/src"
printf 'model\n' > "$FIXTURE/packages/llm-models/src/models.ts"
git -C "$FIXTURE" add packages/llm-models/src/models.ts
git -C "$FIXTURE" commit -qm llm-model
for lane in site-scout sites scout-reconcile; do
  expect_status 0 "$lane"
done

BASE=$(git -C "$FIXTURE" rev-parse HEAD)
mkdir -p "$FIXTURE/packages/astro-opengraph-images/src"
printf 'og\n' > "$FIXTURE/packages/astro-opengraph-images/src/image.ts"
git -C "$FIXTURE" add packages/astro-opengraph-images/src/image.ts
git -C "$FIXTURE" commit -qm astro-opengraph
for lane in site-scout sites scout-reconcile; do
  expect_status 0 "$lane"
done

BASE=$(git -C "$FIXTURE" rev-parse HEAD)
mkdir -p "$FIXTURE/packages/glitter-context/src"
printf 'context\n' > "$FIXTURE/packages/glitter-context/src/context.ts"
git -C "$FIXTURE" add packages/glitter-context/src/context.ts
git -C "$FIXTURE" commit -qm glitter-context
for lane in site-scout sites; do
  expect_status 0 "$lane"
done

# Every main lane that installs the root-scripts production closure reruns when
# that workspace manifest changes.
BASE=$(git -C "$FIXTURE" rev-parse HEAD)
printf '{"name":"@shepherdjerred/root-scripts"}\n' > "$FIXTURE/scripts/package.json"
git -C "$FIXTURE" add scripts/package.json
git -C "$FIXTURE" commit -qm root-scripts-manifest
for lane in site-scout sites scout-reconcile; do
  expect_status 0 "$lane"
done

# An owned source change selects the browser lane.
BASE=$(git -C "$FIXTURE" rev-parse HEAD)
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

# Under Buildkite, each lane records its decision (with evidence) as
# ci-lane-decision-<lane> meta-data, without changing the exit code. The
# stubbed buildkite-agent writes the value to CI_CHANGED_METADATA_PATH.
DECISION_PATH="$FIXTURE/lane-decision"
run_with_decision() {
  lane=$1
  decision_base=$2
  set +e
  (
    cd "$FIXTURE"
    PATH="$FAKE_BIN:$PATH" \
      CI_CHANGED_METADATA_PATH="$DECISION_PATH" \
      CI_CHANGED_BASE="$decision_base" \
      BUILDKITE=true \
      bash "$SELECTOR" "$lane"
  )
  decision_status=$?
  set -e
}

run_with_decision playwright "$BASE"
if [ "$decision_status" -ne 0 ]; then
  echo "decision-recording run expected exit 0, got ${decision_status}" >&2
  exit 1
fi
if ! grep -q '^ran — .*packages/sjer.red/src/index.ts' "$DECISION_PATH"; then
  echo "run decision missing evidence: $(cat "$DECISION_PATH")" >&2
  exit 1
fi

run_with_decision playwright "$(git -C "$FIXTURE" rev-parse HEAD)"
if [ "$decision_status" -ne 78 ]; then
  echo "decision-recording skip expected exit 78, got ${decision_status}" >&2
  exit 1
fi
if ! grep -q '^skipped — unchanged since' "$DECISION_PATH"; then
  echo "skip decision not recorded: $(cat "$DECISION_PATH")" >&2
  exit 1
fi

echo "ci-changed selector tests passed"
