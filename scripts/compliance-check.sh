#!/usr/bin/env bash
set -eu

ERRORS=0

# Guardrail: all packages in monorepo must remain integrated.
if grep -q '"!packages/' package.json; then
  echo 'FAIL: package.json contains excluded workspaces (!packages/...)'
  ERRORS=$((ERRORS+1))
fi

# Documented exemptions ("pkg:script"). A script may be ABSENT only when the
# package genuinely has nothing for it to do — never present as a no-op stub.
# Keep in sync with SKIP_PACKAGES / NO_TEST_PACKAGES in scripts/ci/src/catalog.ts.
EXEMPT="
glitter:build
glitter:test
glitter:lint
glitter:typecheck
resume:test
resume:lint
resume:typecheck
leetcode:test
birmel:build
streambot:build
monarch:build
llm-observability:build
discord-stream-lifecycle:build
trmnl-dashboard:build
tasks-for-obsidian:build
starlight-karma-bot:build
starlight-karma-bot:test
tasknotes-types:build
cooklang-for-obsidian:test
cooklang-rich-preview:test
stocks-sjer-red:test
discord-video-stream:lint
"
# glitter — static placeholder, no source; deployed via DEPLOY_SITES (buildCmd true).
# resume — LaTeX only; build (xelatex) is its sole script, CI uses latexPackageGroup.
# *:build — Bun-runtime packages with no build step (run from source);
#   images are built by dedicated Dagger helpers, not `bun run build`.
#   tasks-for-obsidian builds via Xcode/Gradle; tasknotes-types is source-only.
# *:test — no test suite yet; pkg-check runs --skip-test (NO_TEST_PACKAGES
#   in scripts/ci/src/catalog.ts). Add tests, then remove the exemption.
# discord-video-stream:lint — vendored upstream fork, deliberately unlinted.

is_exempt() {
  case "$EXEMPT" in
    *"
$1:$2
"*) return 0 ;;
    *) return 1 ;;
  esac
}

for dir in packages/*/; do
  PKG=$(basename "$dir")

  # Skip directories that are gitignored (local-only, not part of the repo)
  if git check-ignore -q "$dir" 2>/dev/null; then
    continue
  fi

  if [ ! -f "$dir/package.json" ]; then
    echo "  INFO: $PKG has no package.json (non-Bun package)"
    continue
  fi

  # Check for script contract expected by root automation.
  # (package.json existence is guaranteed by the -f check above.)
  for SCRIPT in build test lint typecheck; do
    if ! grep -q "\"$SCRIPT\"" "$dir/package.json"; then
      if is_exempt "$PKG" "$SCRIPT"; then
        continue
      fi
      echo "  FAIL: $PKG missing $SCRIPT script"
      ERRORS=$((ERRORS+1))
    fi
  done

  # Ban no-op stub scripts: a script that exists must do real work.
  # "true" / ":" / bare "echo ..." stubs read as passing checks that never ran.
  # Match the stub value tolerant of surrounding whitespace and of no-op
  # variants (bare "echo", "echo ...", ":", "true") so e.g. "test": "true "
  # or "lint": "echo" cannot slip a false-green check past this gate.
  NOOPS=$(grep -E "\"(build|test|lint|typecheck)\": *\"[[:space:]]*(true|:|echo([[:space:]][^\"]*)?)[[:space:]]*\"" "$dir/package.json" || printf '')
  if [ -n "$NOOPS" ]; then
    echo "  FAIL: $PKG has no-op stub script(s): $(echo "$NOOPS" | tr -d ' ' | tr '\n' ' ')"
    echo "        Delete the script and add a documented exemption instead."
    ERRORS=$((ERRORS+1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Compliance check failed with $ERRORS error(s)"
  exit 1
fi
echo "All packages compliant"
