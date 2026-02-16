#!/bin/bash
# https://thoughtbot.com/blog/brewfile-a-gemfile-but-for-homebrew

if [[ "$OSTYPE" == "darwin"* ]]; then
  suffix="darwin"
else
  suffix="linux"
fi

rm -f ~/.local/share/chezmoi/.Brewfile_$suffix
brew bundle dump --file=~/.local/share/chezmoi/.Brewfile_$suffix
