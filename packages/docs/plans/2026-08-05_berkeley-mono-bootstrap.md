---
id: plan-2026-08-05-berkeley-mono-bootstrap
type: plan
status: in-progress
board: false
---

# Berkeley Mono Bootstrap

## Goal

Use the licensed static Berkeley Mono TTF files supplied outside the repository,
patch them with Nerd Fonts glyphs, install the patched fonts on macOS, and make
the workflow part of the dotfiles bootstrap without committing proprietary font
files.

## Plan

1. Isolate the change in a feature worktree and preserve the main checkout's
   existing dotfiles edits.
2. Harden the existing Berkeley Mono patcher for pinned, checksum-verified,
   fail-fast use by the macOS bootstrap.
3. Add required tooling and invoke the patch/install workflow from the macOS
   installer using an explicit external source directory.
4. Document the licensed-font boundary and verify the patcher, shell scripts,
   and docs.

## Decisions

- Keep licensed Berkeley Mono inputs and generated fonts outside Git. The
  bootstrap discovers one extracted static TTF package under `~/Downloads`, or
  accepts `BERKELEY_MONO_SOURCE_DIR` for an alternate location.
- Pin Nerd Fonts FontPatcher `v3.5.0` and verify its published SHA-256 digest
  before extraction.
- Treat font contents and macOS registration as the acceptance oracle. FontForge
  output is not byte-identical across runs, so cache/output hashes are not used
  as a correctness signal.

## Implementation

- Added Homebrew dependencies for `fontforge` and `uv`.
- Updated `install_macos.sh` to resolve the active dotfiles source, locate the
  licensed TTF directory, invoke the shared patcher, and install outputs under
  `~/Library/Fonts`.
- Hardened `packages/fonts/patch-berkeley-mono.py` with checksum verification,
  safe archive extraction, input filename validation, per-font isolated output,
  strict one-output enforcement, generic static-style handling, and typed font
  name rewriting.
- Updated the fresh-install guide, package instructions, Chezmoi skill, and
  fonts summary with the licensed-source boundary and operator workflow.

## Verification

- Patched and installed Regular, Bold, Oblique, and Bold Oblique from Berkeley
  Mono v2.004.
- Verified all four installed files with fontTools and `fc-scan`: family/style
  names are correct, each contains 11,325 mapped characters, and representative
  Nerd Font/Powerline codepoints are present.
- Verified macOS reports all four fonts as valid and enabled with Nerd Fonts
  `3.5.0` metadata.
- Passed Ruff, Pyright, ShellCheck, Prettier, Markdownlint, docs validation,
  focused dotfiles build/typecheck/test/lint, and Brewfile satisfiability.

## Session Log — 2026-08-05

### Done

- Implemented and locally verified the Berkeley Mono bootstrap workflow in the
  `feature/berkeley-mono-bootstrap` worktree.
- Installed Homebrew `fontforge` and `uv`, then installed four patched Berkeley
  Mono styles in `~/Library/Fonts`.
- Updated the live Chezmoi helper skill to match its managed source.

### Remaining

- Commit the verified changes, open the stacked pull request, and confirm its
  Buildkite and hosted-review results.

### Caveats

- The licensed source TTFs remain in `~/Downloads`; they are intentionally not
  committed or copied into the repository.
- FontForge output is semantically stable but not byte-identical across runs.
- The main checkout's existing dotfiles work remains untouched and separate
  from this worktree.
