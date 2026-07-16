#!/usr/bin/env bash
# Toolchain preamble — `source`d as the first line of every pipeline step
# that runs repo tasks. On a current ci-base image `mise install` is a fast
# no-op; on a stale one (a PR just changed .mise.toml, or the image predates
# this pipeline) mise bootstraps itself and installs the missing tools at
# runtime, so a toolchain change never waits for the main-only image refresh.
set -euo pipefail

command -v mise >/dev/null || curl -fsSL https://mise.run | sh
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/opt/mise/shims:$PATH"
# mise resolves tool versions via api.github.com; unauthenticated calls share
# the cluster egress IP's 60/hr limit, which CI exhausts immediately. mise
# reads the token from GITHUB_TOKEN (its contract — exempted in
# check-env-var-names.sh); the pod secret provides GH_TOKEN.
if [ -n "${GH_TOKEN:-}" ]; then
  export GITHUB_TOKEN="$GH_TOKEN"
fi
mise trust .mise.toml
mise install --yes

# System tools the tasks shell out to that mise doesn't manage. Baked into
# the fresh ci-base; bootstrapped here on a stale image.
if ! command -v rsync >/dev/null; then
  apt-get update -qq && apt-get install -y -qq --no-install-recommends rsync
fi
if ! command -v swiftlint >/dev/null; then
  # Official linux artifact; same recipe as .buildkite/ci-image/Dockerfile
  # (which bakes it in) — keep the two in sync.
  # renovate: datasource=github-releases depName=realm/SwiftLint
  SWIFTLINT_VERSION="0.61.0"
  curl -fsSL "https://github.com/realm/SwiftLint/releases/download/${SWIFTLINT_VERSION}/swiftlint_linux_amd64.zip" -o /tmp/swiftlint.zip
  unzip -q -o /tmp/swiftlint.zip -d /usr/local/swiftlint
  # The dynamic binary needs Swift runtime libs the zip doesn't carry
  # (exec fails as 127); the -static build is self-contained.
  ln -sf /usr/local/swiftlint/swiftlint-static /usr/local/bin/swiftlint
  rm /tmp/swiftlint.zip
fi
