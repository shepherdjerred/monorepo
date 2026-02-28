#!/usr/bin/env bash
set -euo pipefail

# Install Bazel via Bazelisk
BAZELISK_VERSION="1.25.0"
echo "--- :bazel: Installing Bazelisk ${BAZELISK_VERSION}"
curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-amd64" -o /usr/local/bin/bazel
chmod +x /usr/local/bin/bazel

# Install uv for Python script execution
echo "--- :python: Installing uv"
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

echo "+++ :bazel: Build & Test"
cd scripts/ci
uv run -m ci.build_and_test
