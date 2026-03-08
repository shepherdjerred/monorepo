#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel

echo "+++ :bazel: Buildifier format & lint check"

# Build hermetic buildifier from multitool, then get its path
bazel build --config=ci @multitool//tools/buildifier >/dev/null 2>&1
BUILDIFIER=$(bazel cquery --config=ci --output=files @multitool//tools/buildifier 2>/dev/null)

# Find all Bazel files
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find . \( -name 'BUILD.bazel' -o -name '*.bzl' -o -name 'MODULE.bazel' -o -name 'REPO.bazel' \) \
  -not -path '*/node_modules/*' -not -path '*/bazel-*/*' -not -path '*/.git/*' -print0)

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No Bazel files found"
  exit 0
fi

# Diff-based check: copy files, run buildifier --lint=fix on copies, diff against originals.
# buildifier --lint=warn does NOT fail on lint warnings, only on format issues.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

for f in "${FILES[@]}"; do
  mkdir -p "$WORK/$(dirname "$f")"
  cp "$f" "$WORK/$f"
done

"$BUILDIFIER" --lint=fix "${FILES[@]/#/$WORK/}" 2>/dev/null || true

FAILED=0
for f in "${FILES[@]}"; do
  if ! diff -q "$f" "$WORK/$f" >/dev/null 2>&1; then
    echo "FAIL: $f needs formatting/lint fixes:"
    diff -u "$f" "$WORK/$f" || true
    echo
    FAILED=1
  fi
done

if [ "$FAILED" -eq 1 ]; then
  echo "Run locally: buildifier --lint=fix \$(find . \\( -name BUILD.bazel -o -name '*.bzl' -o -name MODULE.bazel -o -name REPO.bazel \\) ! -path '*/node_modules/*' ! -path '*/bazel-*/*')" >&2
  exit 1
fi

echo "Buildifier check passed"
