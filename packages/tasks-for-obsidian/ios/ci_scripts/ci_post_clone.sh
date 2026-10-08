#!/bin/bash
set -euo pipefail

if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  facet_repo_root="$CI_PRIMARY_REPOSITORY_PATH"
else
  facet_script_directory="$(cd "$(dirname "$0")" && pwd)"
  facet_repo_root="$(cd "$facet_script_directory/../../../.." && pwd)"
fi

cd "$facet_repo_root"
facet_mise="$facet_repo_root/bin/mise"
"$facet_mise" trust "$facet_repo_root/.mise.toml"
"$facet_mise" install --yes bun rust aqua:yonaskolb/XcodeGen
# Tools are installed explicitly above. Do not let exec provision the rest of
# the monorepo tool inventory in Apple's temporary native build environment.
export MISE_EXEC_AUTO_INSTALL=false
"$facet_mise" exec -- bun install --frozen-lockfile --ignore-scripts

cd "$facet_repo_root/packages/tasknotes-core"
"$facet_mise" exec -- rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
"$facet_mise" exec -- cargo xtask build-xcframework --platform ios --platform ios-sim
"$facet_mise" exec -- cargo xtask check-xcframework
"$facet_mise" exec -- bun ../tasknotes-macos/scripts/generate-native-notices.ts --ios

cd "$facet_repo_root/packages/tasks-for-obsidian/ios"
"$facet_mise" exec -- xcodegen generate
