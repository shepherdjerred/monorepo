Project provides a command-line workflow to patch static Berkeley Mono TTF
fonts with Nerd Fonts glyphs, preserve Berkeley Mono family/style names, and
optionally install or archive the results. The Python 3.10 script uses
fontTools and fontforge, downloads a checksum-verified pinned Nerd Fonts
FontPatcher release into `~/.cache/nerd-fonts-patcher`, fails if any input does
not produce exactly one patched TTF, and supports zip creation or installation
to `~/Library/Fonts`. The macOS dotfiles bootstrap invokes this workflow using
licensed source fonts supplied outside the repository.
