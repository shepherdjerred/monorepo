#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091 # runtime path relative to this Buildkite script
source "$(dirname "$0")/setup-tools.sh"

install_bun

echo "+++ :iphone: TasksForObsidian iOS native dependency check"
cd packages/tasks-for-obsidian
bun install --frozen-lockfile --linker hoisted
bun run check:ios-native-deps
