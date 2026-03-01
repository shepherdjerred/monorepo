#!/usr/bin/env bash
# Download static CI tool binaries into a staging directory.
# Usage: download_tools.sh <output_dir>
set -euo pipefail

OUTPUT_DIR="${1:?Usage: download_tools.sh <output_dir>}"
mkdir -p "$OUTPUT_DIR/usr/local/bin"

BAZELISK_VERSION="1.25.0"
TARGET_DETERMINATOR_VERSION="0.32.0"

echo "Downloading bazelisk ${BAZELISK_VERSION}..."
curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-amd64" \
    -o "$OUTPUT_DIR/usr/local/bin/bazel"
chmod +x "$OUTPUT_DIR/usr/local/bin/bazel"

echo "Downloading uv..."
curl -LsSf https://astral.sh/uv/install.sh | CARGO_HOME="$OUTPUT_DIR/usr/local" sh
# uv installer puts binary in CARGO_HOME/bin
mv "$OUTPUT_DIR/usr/local/bin/uv" "$OUTPUT_DIR/usr/local/bin/uv" 2>/dev/null || true
# Clean up any installer artifacts
rm -f "$OUTPUT_DIR/usr/local/bin/uvx" 2>/dev/null || true

echo "Downloading target-determinator ${TARGET_DETERMINATOR_VERSION}..."
curl -fsSL "https://github.com/bazel-contrib/target-determinator/releases/download/v${TARGET_DETERMINATOR_VERSION}/target-determinator.linux.amd64" \
    -o "$OUTPUT_DIR/usr/local/bin/target-determinator"
chmod +x "$OUTPUT_DIR/usr/local/bin/target-determinator"

echo "Downloading ripgrep..."
curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp
cp /tmp/ripgrep-14.1.1-x86_64-unknown-linux-musl/rg "$OUTPUT_DIR/usr/local/bin/rg"
chmod +x "$OUTPUT_DIR/usr/local/bin/rg"

echo "All tools downloaded to $OUTPUT_DIR"
