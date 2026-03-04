#!/usr/bin/env bash
# Shell wrapper for running cargo-deny in the Bazel sandbox.
# Checks advisories, bans, and sources against deny.toml config.

set -euo pipefail

# Set up a writable CARGO_HOME for the sandbox since the real one is read-only.
# cargo-deny needs to download advisory database and crate index.
export CARGO_HOME="${TEST_TMPDIR:-/tmp}/cargo-home"
mkdir -p "$CARGO_HOME"

# Ensure rustup can find a toolchain (sandbox strips HOME/defaults)
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}"

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

cargo-deny --manifest-path Cargo.toml check advisories bans sources
