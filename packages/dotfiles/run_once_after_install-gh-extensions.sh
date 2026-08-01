#!/bin/bash
set -euo pipefail

# Provision the `gh stack` extension (github/gh-stack) that AGENTS.md mandates for
# new stacked-PR work. `gh` itself comes from the Brewfile, but gh extensions are
# per-user state that `brew bundle` cannot express, so they are installed here.
#
# Idempotent: skips when the extension is already present. If this runs before
# `brew bundle` has installed `gh`, it exits non-zero and chezmoi re-runs it on
# the post-Brewfile apply, so the extension always lands once `gh` exists.
if gh extension list | grep -q 'github/gh-stack'; then
  echo "gh-stack extension already installed"
else
  gh extension install github/gh-stack
fi
