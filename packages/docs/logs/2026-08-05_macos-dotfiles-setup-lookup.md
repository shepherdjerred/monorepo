---
id: log-2026-08-05-macos-dotfiles-setup-lookup
type: log
status: complete
board: false
---

# macOS Dotfiles Setup Lookup

Identify the macOS setup/bootstrap entry points in `packages/dotfiles` and
report how they are intended to be run.

## Findings

- `packages/dotfiles/install_macos.sh` is the automated macOS bootstrap.
- `packages/dotfiles/install.sh` targets Linux and is not the macOS entry point.
- `packages/dotfiles/MACOS_FRESH_INSTALL.md` documents the manual work that
  remains after the automated installer, including credentials, full Xcode,
  privacy approvals, application sign-ins, and final verification.
- When run from an existing checkout, `DOTFILES_LOCAL_PATH` can point the
  installer at `packages/dotfiles`; otherwise it clones the monorepo into
  `~/git/monorepo` and initializes Chezmoi from there.

## Session Log — 2026-08-05

### Done

- Located and inspected the macOS and Linux installers under
  `packages/dotfiles`.
- Identified the automated macOS bootstrap and its companion manual checklist.
- Continued the resulting Berkeley Mono implementation in
  `packages/docs/plans/2026-08-05_berkeley-mono-bootstrap.md`.

### Remaining

- Complete the pull-request and CI follow-through recorded in the Berkeley Mono
  plan.

### Caveats

- The installer intentionally leaves credentials, full Xcode, privacy grants,
  and application sign-ins as manual steps.
- The live checkout already had local modifications to `install_macos.sh` and
  `MACOS_FRESH_INSTALL.md`; this lookup did not alter either file.
- The implementation is isolated in a worktree so those main-checkout changes
  remain untouched.
