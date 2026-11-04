#!/bin/bash
# https://thoughtbot.com/blog/brewfile-a-gemfile-but-for-homebrew
set -euo pipefail

if [[ "$OSTYPE" == "darwin"* ]]; then
  suffix="darwin"
else
  suffix="linux"
fi

# .Brewfile_darwin is the full workstation dump; agent hosts render a filtered
# subset of it, so dumping one would silently drop the desktop packages.
if [[ "$(chezmoi execute-template '{{ .profile }}')" == "agent-host" ]]; then
  echo "Refusing to dump the Brewfile from an agent-host machine; run this on a workstation." >&2
  exit 1
fi

source_dir="$(chezmoi source-path)"
brewfile="${source_dir}/.Brewfile_${suffix}"

rm -f "$brewfile"
brew bundle dump --file="$brewfile"
