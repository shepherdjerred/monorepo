#!/usr/bin/env bash
# Shell wrapper for running cargo-deny in the Bazel sandbox.
# Checks advisories, bans, and sources against deny.toml config.
# Uses a hermetic cargo-deny binary provided via $CARGO_DENY_BIN from @multitool
# and a hermetic cargo binary provided via $CARGO_BIN from @rules_rust.

set -euo pipefail

# Set up a writable CARGO_HOME for the sandbox since the real one is read-only.
# cargo-deny needs to download advisory database and crate index.
export CARGO_HOME="${TEST_TMPDIR:-/tmp}/cargo-home"
mkdir -p "$CARGO_HOME"

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"

# Resolve hermetic binaries to absolute paths from runfiles
CARGO_DENY="$(cd "$RUNFILES/$WS" && pwd)/$CARGO_DENY_BIN"
CARGO="$(cd "$RUNFILES/$WS" && pwd)/$CARGO_BIN"
RUSTC="$(cd "$RUNFILES/$WS" && pwd)/$RUSTC_BIN"

# Put hermetic cargo and rustc on PATH so cargo-deny can find them for `cargo metadata`
# hermeticity-exempt: cargo-deny shells out to cargo/rustc which need PATH discovery
CARGO_DIR="$(dirname "$CARGO")"
RUSTC_DIR="$(dirname "$RUSTC")"
export PATH="$CARGO_DIR:$RUSTC_DIR:$PATH"

cd "$RUNFILES/$WS/$PKG_DIR"

"$CARGO_DENY" --manifest-path Cargo.toml check advisories bans sources
