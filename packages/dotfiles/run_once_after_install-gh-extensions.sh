#!/bin/bash
set -euo pipefail

# Provision the `gh stack` extension (github/gh-stack) that AGENTS.md mandates for
# new stacked-PR work. `gh` itself comes from the Brewfile, but gh extensions are
# per-user state that `brew bundle` cannot express, so they are installed here.
#
# Pin to the exact version the vendored skill documents — keep this in lockstep
# with `github-ref: refs/tags/v0.1.0` in
# packages/dotfiles/dot_agents/skills/gh-stack/SKILL.md so the installed binary and
# the vendored skill never drift. Bump both together.
#
# Idempotent: no-op when the pinned version is already installed; if a different
# version is present (e.g. an earlier unpinned `latest` install), reinstall the
# pinned one. If this runs before `brew bundle` has installed `gh`, `gh extension
# list` exits non-zero and chezmoi re-runs this script on the post-Brewfile apply,
# so the extension always lands once `gh` exists.
gh_stack_version="v0.1.0"

installed_version="$(gh extension list | awk -F'\t' '$2 == "github/gh-stack" { print $3 }')"

if [ "$installed_version" = "$gh_stack_version" ]; then
  echo "gh-stack extension ${gh_stack_version} already installed"
elif [ -n "$installed_version" ]; then
  echo "gh-stack extension ${installed_version} installed; repinning to ${gh_stack_version}"
  gh extension remove github/gh-stack
  gh extension install github/gh-stack --pin "$gh_stack_version"
else
  gh extension install github/gh-stack --pin "$gh_stack_version"
fi
