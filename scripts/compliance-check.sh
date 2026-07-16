#!/usr/bin/env bash
set -eu

ERRORS=0

# Guardrail: all packages in monorepo must remain integrated.
if grep -q '"!packages/' package.json; then
  echo 'FAIL: package.json contains excluded workspaces (!packages/...)'
  ERRORS=$((ERRORS+1))
fi

# Documented exemptions ("<packages-relative-dir>:script"). A script may be
# ABSENT — or present as a deliberate no-op stub — ONLY when the package
# genuinely has nothing for it to do and that fact is documented here.
# Keys are the package's path under the repo root so nested workspace packages
# (e.g. scout-for-lol/packages/frontend) never collide with a same-named
# sibling (e.g. discord-plays-pokemon/packages/common vs
# discord-plays-mario-kart/packages/common).
EXEMPT="
packages/glitter:build
packages/glitter:test
packages/glitter:lint
packages/glitter:typecheck
packages/resume:test
packages/resume:lint
packages/resume:typecheck
packages/leetcode:test
packages/birmel:build
packages/streambot:build
packages/monarch:build
packages/llm-observability:build
packages/discord-stream-lifecycle:build
packages/discord-plays-core:build
packages/trmnl-dashboard:build
packages/tasks-for-obsidian:build
packages/starlight-karma-bot:build
packages/tasknotes-types:build
packages/cooklang-rich-preview:test
packages/stocks-sjer-red:test
packages/discord-video-stream:lint
packages/discord-plays-mario-kart/packages/common:test
packages/discord-plays-pokemon/packages/common:test
packages/discord-plays-pokemon/packages/frontend:test
packages/scout-for-lol/packages/app:test
packages/scout-for-lol/packages/data:build
packages/scout-for-lol/packages/desktop:test
packages/scout-for-lol/packages/frontend:test
packages/scout-for-lol/packages/ui:build
packages/scout-for-lol/packages/ui:test
packages/scout-for-lol:build
packages/scout-for-lol:test
packages/scout-for-lol:lint
packages/scout-for-lol:typecheck
packages/home-assistant:build
packages/sjer.red:test
packages/temporal:build
packages/homelab:build
packages/homelab:test
packages/homelab:lint
packages/homelab:typecheck
packages/discord-plays-pokemon/packages/backend:build
packages/discord-plays-mario-kart/packages/backend:build
"
# glitter — static placeholder, no source.
# resume — LaTeX only; build (xelatex) is its sole script.
# *:build — Bun-runtime / source-only / library packages with no build step
#   (run from source). tasks-for-obsidian builds via Xcode/Gradle; tasknotes-types,
#   scout `data`, and scout `ui` are source-only.
# *:test — no test suite yet. Add tests, then remove the exemption.
#   dpp/mk64 common + dpp/scout desktop/frontend keep a placeholder `test` stub
#   ("true" / "echo ...", tests not wired yet) — exempted here rather than deleted.
# discord-video-stream:lint — vendored upstream fork, deliberately unlinted.
# scout-for-lol (parent) — anchor package only: hosts the family eslint.config.ts,
#   dev:web tooling, and shared scripts/. All build/test/lint/typecheck live in its
#   child packages. Dissolving the anchor is tracked on PR #1518's checklist.
# home-assistant:build — source-only (vestigial in-place tsc build removed with
#   the workspace migration; consumers import TS sources via workspace symlink).
# sjer.red:test — Playwright only; lives in test:e2e outside the default chain
#   (needs installed browsers; the old CI ran it in a Playwright container).
# temporal / dpp-backend / dpmk-backend :build — tsconfig is noEmit, so build
#   was a typecheck duplicate; Bun-runtime services run from source.
# homelab (parent) — anchor package: children (@homelab/cdk8s,
#   @shepherdjerred/helm-types) are workspace members with their own tasks;
#   the parent keeps check:talos + lint:helm and the family eslint config.

is_exempt() {
  case "$EXEMPT" in
    *"
$1:$2
"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Enumerate the true workspace package set: every top-level packages/* plus the
# nested workspace members each one declares via its `workspaces` field. This is
# the set root automation + CI actually run scripts for, so a nested package
# can't hide a no-op stub outside a top-level-only scan. Standalone example/demo
# dirs (e.g. astro-opengraph-images/examples/*) are NOT workspace members and are
# excluded. Enumeration runs via `bun` (always present in the CI base image) so
# the check has no git/python dependency.
PKG_DIRS=$(bun run - <<'BUN_EOF'
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { Glob } from "bun";

function readPkg(dir) {
  try {
    return JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  } catch {
    return null;
  }
}
function workspaces(pkg) {
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

const selected = new Set();
function visit(dir) {
  if (selected.has(dir)) return;
  const pkg = readPkg(dir);
  if (!pkg) return;
  selected.add(dir);
  for (const pattern of workspaces(pkg)) {
    for (const match of new Glob(`${dir}/${pattern}/package.json`).scanSync(".")) {
      visit(match.slice(0, -"/package.json".length));
    }
  }
}

for (const name of readdirSync("packages")) {
  const dir = `packages/${name}`;
  if (existsSync(`${dir}/package.json`)) visit(dir);
}

for (const dir of [...selected].sort()) console.log(dir);
BUN_EOF
)

while IFS= read -r dir; do
  [ -z "$dir" ] && continue
  pj="$dir/package.json"

  # Check for script contract expected by root automation.
  for SCRIPT in build test lint typecheck; do
    if ! grep -q "\"$SCRIPT\"" "$pj"; then
      if is_exempt "$dir" "$SCRIPT"; then
        continue
      fi
      echo "  FAIL: $dir missing $SCRIPT script"
      ERRORS=$((ERRORS+1))
    fi
  done

  # Ban no-op stub scripts: a script that exists must do real work.
  # "true" / ":" / bare "echo ..." stubs read as passing checks that never ran.
  # Match the stub value tolerant of surrounding whitespace and of no-op
  # variants (bare "echo", "echo ...", ":", "true") so e.g. "test": "true "
  # or "lint": "echo" cannot slip a false-green check past this gate. A stub is
  # allowed only when the "<dir>:<script>" pair is a documented exemption above.
  NOOP_LINES=$(grep -E "\"(build|test|lint|typecheck)\": *\"[[:space:]]*(true|:|echo([[:space:]][^\"]*)?)[[:space:]]*\"" "$pj" || printf '')
  if [ -n "$NOOP_LINES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      SCRIPT=$(printf '%s' "$line" | sed -E 's/.*"(build|test|lint|typecheck)".*/\1/')
      if is_exempt "$dir" "$SCRIPT"; then
        continue
      fi
      echo "  FAIL: $dir has no-op stub script: $(printf '%s' "$line" | tr -d ' ')"
      echo "        Delete the script and add a documented exemption instead."
      ERRORS=$((ERRORS+1))
    done <<INNER
$NOOP_LINES
INNER
  fi
done <<EOF
$PKG_DIRS
EOF

if [ "$ERRORS" -gt 0 ]; then
  echo "Compliance check failed with $ERRORS error(s)"
  exit 1
fi
echo "All packages compliant"
