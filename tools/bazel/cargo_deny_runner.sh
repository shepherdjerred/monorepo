#!/usr/bin/env bash
# Shell wrapper for running cargo-deny in the Bazel sandbox.
# Checks advisories, bans, and sources against deny.toml config.

set -euo pipefail

# Bazel's strict action env strips PATH and HOME; restore common locations.
# Use tilde expansion as fallback when HOME is unset (bash resolves ~ from /etc/passwd).
if [ -z "${HOME:-}" ]; then
  export HOME
  HOME=$(bash -c 'cd ~ && pwd' 2>/dev/null) || HOME=/tmp
fi
# Use mise installs directly (not shims) to avoid .mise.toml trust issues in execroot.
# Disable mise activation so it doesn't try to read untrusted config files.
export MISE_DISABLED=1
MISE_INSTALLS="${HOME}/.local/share/mise/installs"
# Find the mise-managed Rust toolchain that has cargo-deny installed.
RUST_BIN=""
if [ -d "$MISE_INSTALLS/rust" ]; then
  RUST_BIN=$(find "$MISE_INSTALLS/rust" -maxdepth 3 -name cargo-deny -type f 2>/dev/null | head -1 | xargs -r dirname)
fi
export PATH="${RUST_BIN:+$RUST_BIN:}${HOME}/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

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
