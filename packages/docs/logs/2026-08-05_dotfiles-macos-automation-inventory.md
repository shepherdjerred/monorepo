---
id: 2026-08-05-dotfiles-macos-automation-inventory
type: log
status: complete
board: false
---

# Dotfiles macOS automation inventory

## Answer

The Chezmoi source automates macOS preference files, selected Quick Look
extensions, and default application handlers. It does not currently declare
Mac App Store installs.

## Evidence

- `private_dot_config/macos-defaults/` contains declarative preference YAML and
  `run_onchange_after_apply-macos-defaults.sh.tmpl` applies it with
  `macos-defaults`.
- `.Brewfile_darwin` installs `qlmarkdown` and `syntax-highlight`; the fresh
  installer opens both apps for their required first-launch Gatekeeper approval.
- `run_after_set-default-apps.sh.tmpl` uses `duti` to assign handlers
  for text/source files, media, Affinity files, archives, web links, email,
  RSS, SSH, and webcal links.
- The Darwin Brewfile has no `mas` formula or `mas` application declarations.

## Session Log — 2026-08-05

### Done

- Inspected the managed macOS preferences, Brewfile, Quick Look entries,
  fresh-install flow, and `duti` associations.
- Confirmed that Mac App Store installation is not tracked by the current
  dotfiles source.
- Changed the default-app hook to `run_after_`, so the post-Homebrew Chezmoi
  apply always configures the associations.
- Replaced LaunchServices-rejected dynamic extension identifiers with registered
  app UTIs and corrected URL-scheme command syntax; applied all associations on
  this Mac successfully.
- Verified concrete file handlers with `duti -x` and URL-scheme handlers with
  macOS's `NSWorkspace.urlForApplication(toOpen:)` API.
- Diagnosed the incorrect live `http`/`https` handlers as Sublime Text and set
  both URL schemes to Safari.
- Committed the source and session log as `fix(dotfiles): restore default apps
after brew` on the tracked `feature/dotfiles-default-apps` stack.

### Remaining

- None for the requested default-app fix.

### Caveats

- Quick Look extensions require macOS/Gatekeeper first-launch approval on a new
  machine.
- The hook intentionally reports and returns successfully when `duti` is not
  installed during the initial pre-Homebrew apply. The post-Homebrew
  `run_after_` pass then performs the configuration.
- Draft PR publication is blocked because `git-spice` has no GitHub
  authentication token in this environment.

## Workflow Friction

- `bunx turbo run generate` replayed cached Scout generation output into the
  separate `.claude/worktrees/berkeley-mono-bootstrap/` worktree because that
  cache entry retained an absolute output path. This dotfiles change did not
  need the generated artifact, but cache replay should be made worktree-safe
  before relying on it in parallel worktrees.
