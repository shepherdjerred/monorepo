# fonts

One script: `patch-berkeley-mono.py` patches the Berkeley Mono desktop TTFs
with Nerd Fonts glyphs. It downloads a pinned Nerd Fonts `FontPatcher.zip`
(version and SHA-256 hard-coded in the script, Renovate-tracked), verifies its
checksum, patches every `*.ttf` found in the input directory (recursing into
subdirectories if none are at the top level) with `font-patcher --complete
--mono`, rewrites the internal name records back to the plain `Berkeley Mono`
family (undoing the patcher's "Nerd Font" renaming), and optionally installs
or zips the result. Input files must follow the static package's naming
`BerkeleyMono-<Style>.ttf`; outputs keep that naming.

## Usage

```bash
# Requirements: uv, fontforge (brew install fontforge), curl
uv run patch-berkeley-mono.py <input_dir> [output_dir] [--install] [--zip]

# Example: patch the extracted license package and install
uv run patch-berkeley-mono.py ~/Downloads/berkeley-ttf ~/Downloads/patched --install
```

The default `output_dir` is `./patched`, relative to your working directory;
`packages/fonts/patched` is ignored by Git. `--install` copies the patched
fonts to `~/Library/Fonts` but does not remove them from the output directory.

- `input_dir` — directory containing the Berkeley Mono static TTFs
- `output_dir` — defaults to `./patched`
- `--install` — copy patched fonts to `~/Library/Fonts`
- `--zip` — create `BerkeleyMono-NerdFont.zip` next to the output directory

The downloaded FontPatcher is cached in `~/.cache/nerd-fonts-patcher/` and
reused across runs.

## Where the fonts come from

The macOS bootstrap (`packages/dotfiles/install_macos.sh`) invokes this script
during fresh-machine setup with the TTF package extracted under `~/Downloads`.
The web consoles use separate WOFF2 files that ship with
[`@shepherdjerred/console-ui`](../console-ui/README.md).
