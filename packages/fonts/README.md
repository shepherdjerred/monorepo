# fonts

One script: `patch-berkeley-mono.py` patches the licensed Berkeley Mono TTFs
with Nerd Fonts glyphs. It downloads a pinned Nerd Fonts `FontPatcher.zip`
(version and SHA-256 hard-coded in the script, Renovate-tracked), verifies its
checksum, patches every `*.ttf` found in the input directory (recursing into
subdirectories if none are at the top level) with `font-patcher --complete
--mono`, rewrites the internal name records back to the plain `Berkeley Mono`
family (undoing the patcher's "Nerd Font" renaming), and optionally installs
or zips the result. Input files must follow the licensed static naming
`BerkeleyMono-<Style>.ttf`; outputs keep that naming.

## Usage

```bash
# Requirements: uv, fontforge (brew install fontforge), curl
uv run patch-berkeley-mono.py <input_dir> [output_dir] [--install] [--zip]

# Example: patch the extracted license package and install
uv run patch-berkeley-mono.py ~/Downloads/berkeley-ttf ~/Downloads/patched --install
```

Always pass an explicit `output_dir` outside the repository. The default is
`./patched`, relative to your working directory — run the script from
`packages/fonts` without an `output_dir` and the licensed patched TTFs land in
`packages/fonts/patched`, inside the checkout. `--install` copies them to
`~/Library/Fonts` but does not remove them from the output directory.

- `input_dir` — directory containing the licensed Berkeley Mono TTFs
- `output_dir` — defaults to `./patched`; always pass a path outside the repo
- `--install` — copy patched fonts to `~/Library/Fonts`
- `--zip` — create `BerkeleyMono-NerdFont.zip` next to the output directory

The downloaded FontPatcher is cached in `~/.cache/nerd-fonts-patcher/` and
reused across runs.

## License constraint

Berkeley Mono is a commercially licensed font. Never commit the licensed
source TTFs or the patched outputs to the repository — the script reads them
from outside the repo (e.g. `~/Downloads`) and writes outside it. The macOS
bootstrap (`install_macos.sh`) invokes this script during fresh-machine setup;
see the root [CLAUDE.md](../../CLAUDE.md).
