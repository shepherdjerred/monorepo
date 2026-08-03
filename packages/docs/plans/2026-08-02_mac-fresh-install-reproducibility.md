---
id: plan-2026-08-02-mac-fresh-install-reproducibility
type: plan
status: in-progress
board: false
---

# Mac Fresh-Install Reproducibility

## Goal

Turn the MacBook audit decisions into a reviewable desired-state update: remove
software Jerred no longer uses, preserve the active macOS interaction settings,
and make privacy-permission recovery explicit without relying on unsupported TCC
database manipulation.

## Decisions

- Remove LinearMouse, Raycast, and Orion from the tracked install manifest.
- Replace LinearMouse with the currently used BetterMouse package.
- Remove the tracked LinearMouse and Raycast preferences; Orion has no tracked
  preferences.
- Treat Xcode as an explicit manual install rather than a Brew/MAS dependency.
- Exclude Microsoft Office, OneDrive, and Honorlock from the desired machine
  profile.
- Do not preserve or validate OrbStack containers or volumes as part of wipe
  readiness.
- Treat synchronized services as the source of truth for user data and dotfiles
  as the source of truth for configuration; a conventional machine backup is
  not part of the recovery design.
- Track the observed global appearance, key behavior, Dock, and trackpad
  preferences through the existing `macos-defaults` mechanism.
- Use only Apple-supported privacy controls. If grants cannot be provisioned on
  an unmanaged personal Mac, capture the required grants and verification as a
  concise manual recovery checklist instead of modifying the TCC database.

## Implementation

- Reconcile the stale Brew casks and obsolete application configuration.
- Add domain-scoped YAML for the observed macOS preferences and validate it with
  the repository's `macos-defaults` workflow without changing unrelated live
  preferences.
- Document the privacy-permission boundary and the app-specific setup checklist
  for the desired application set.
- Update the audit so its gaps and recommendations reflect the decisions above.
- Keep broader package-manifest reconciliation and bootstrap-order hardening as
  clearly identified follow-up work unless required for these changes to work.

## Verification

- Validate the edited Brewfile syntax and desired cask set.
- Validate or dry-run the new `macos-defaults` files.
- Render the chezmoi source in a temporary destination and inspect the diff.
- Run focused shell, formatting, Markdown, and docs-model checks.
- Run the staged-file pre-commit gate before publication.

## Session Log — 2026-08-02

### Done

- Recorded the desired-state decisions and implementation boundary.
- Replaced LinearMouse with BetterMouse in the tracked Brew bundle and removed
  Orion, Raycast, and their obsolete tracked configuration.
- Added declarative global, Dock, built-in trackpad, and current-host trackpad
  preferences matching the live Mac.
- Confirmed Apple-supported PPPC deployment requires supervised device
  management and that `tccutil` can reset but not grant decisions.
- Added the manual fresh-install and least-privilege privacy checklist, excluded
  it from home placement, and made the installer report remaining manual work.
- Applied and verified the updated Brewfile and four defaults files against the
  live home directory.
- Passed the focused Brew, macos-defaults, chezmoi, temporary-home, dotfiles
  package, shell, formatting, Markdown, docs-model, and link checks.
- Published draft pull request #1959.
- Updated the wipe-readiness standard to require completed synchronization and
  documented service re-enrollment rather than a conventional backup.

### Remaining

- Verify its current-head Buildkite and review state.
- Complete a disposable-user or spare-Mac restore rehearsal before a real wipe.

### Caveats

- Dotfiles do not own user data. Important data must have a named, fully current
  sync source; local-only working-tree changes still require commit/push or an
  explicit decision to discard them.
- Privacy grants require interactive approval on this unmanaged personal Mac;
  the repository tracks the checklist and expected feature tests, not TCC state.
- Full Xcode remains manual; Microsoft Office, OneDrive, and Honorlock are
  intentionally excluded; OrbStack state is intentionally disposable.
- The remaining Brew inventory and bootstrap-order gaps from the audit are not
  solved by this focused desired-state update.
