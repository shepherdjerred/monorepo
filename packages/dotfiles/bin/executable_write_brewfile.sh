#!/bin/bash
# https://thoughtbot.com/blog/brewfile-a-gemfile-but-for-homebrew
set -euo pipefail

if [[ "$OSTYPE" == "darwin"* ]]; then
  suffix="darwin"
else
  suffix="linux"
fi

source_dir="$(chezmoi source-path)"
brewfile="${source_dir}/.Brewfile_${suffix}"

rm -f "$brewfile"
brew bundle dump --file="$brewfile"
