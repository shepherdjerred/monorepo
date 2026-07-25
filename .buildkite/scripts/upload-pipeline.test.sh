#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
UPLOADER="${SCRIPT_DIR}/upload-pipeline.sh"
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.email ci-upload@example.invalid
git -C "$FIXTURE" config user.name "CI upload test"
mkdir -p "$FIXTURE/packages/sjer.red" "$FIXTURE/packages/docs" "$FIXTURE/fake-bin"
printf 'source\n' > "$FIXTURE/packages/sjer.red/source.ts"
git -C "$FIXTURE" add packages/sjer.red/source.ts
git -C "$FIXTURE" commit -qm baseline
BASE=$(git -C "$FIXTURE" rev-parse HEAD)
git -C "$FIXTURE" mv packages/sjer.red/source.ts packages/docs/source.ts
git -C "$FIXTURE" commit -qm rename

cat > "$FIXTURE/fake-bin/buildkite-agent" <<'EOF'
#!/bin/sh
if [ "$1" != pipeline ] || [ "$2" != upload ] || [ "$3" != --changed-files-path ]; then
  echo "unexpected buildkite-agent invocation: $*" >&2
  exit 2
fi
cp "$4" "$CAPTURE_PATH"
EOF
chmod +x "$FIXTURE/fake-bin/buildkite-agent"

CAPTURE_PATH="$FIXTURE/changed" \
  CI_CHANGED_FILES_BASE="$BASE" \
  PATH="$FIXTURE/fake-bin:$PATH" \
  sh -c "cd '$FIXTURE' && sh '$UPLOADER'"

expected=$(printf '%s\n' packages/docs/source.ts packages/sjer.red/source.ts)
actual=$(cat "$FIXTURE/changed")
if [ "$actual" != "$expected" ]; then
  echo "rename-safe changed files differ" >&2
  printf 'expected:\n%s\nactual:\n%s\n' "$expected" "$actual" >&2
  exit 1
fi

CAPTURE_PATH="$FIXTURE/fallback" \
  CI_CHANGED_FILES_BASE=missing-ref \
  PATH="$FIXTURE/fake-bin:$PATH" \
  sh -c "cd '$FIXTURE' && sh '$UPLOADER'"
if [ "$(cat "$FIXTURE/fallback")" != ".buildkite/pipeline.yml" ]; then
  echo "invalid diff base did not fail open" >&2
  exit 1
fi

echo "pipeline upload changed-file tests passed"
