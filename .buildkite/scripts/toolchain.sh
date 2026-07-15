#!/usr/bin/env bash
# Toolchain preamble — `source`d as the first line of every pipeline step
# that runs repo tasks. On a current ci-base image `mise install` is a fast
# no-op; on a stale one (a PR just changed .mise.toml, or the image predates
# this pipeline) mise bootstraps itself and installs the missing tools at
# runtime, so a toolchain change never waits for the main-only image refresh.
set -euo pipefail

command -v mise >/dev/null || curl -fsSL https://mise.run | sh
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/mise/shims:$PATH"
mise trust .mise.toml
mise install --yes
