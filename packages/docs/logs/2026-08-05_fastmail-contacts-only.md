---
id: log-2026-08-05-fastmail-contacts-only
type: log
status: complete
board: false
---

# Fastmail Contacts-Only Setup

Replace the fresh-install Apple Mail and Exchange profile automation with a
single Fastmail CardDAV profile for Contacts.

## Session Log — 2026-08-05

### Done

- Inspected the existing mail profile templates and installer.
- Confirmed that the existing Fastmail profile configured IMAP/SMTP only and
  did not configure contact syncing.
- Removed the Fastmail IMAP/SMTP profile, all three Outlook/Exchange profiles,
  and the mail-profile installer.
- Added a Fastmail contacts-only CardDAV profile and one-time installer.
- Removed the generated mail profiles from the live filesystem and applied the
  new contacts profile to `~/.config/contact-profiles/fastmail.mobileconfig`.
- Validated both source and live profiles with `plutil`, checked the rendered
  installer with `bash -n` and ShellCheck, and confirmed the live profile is
  byte-for-byte identical to its chezmoi source.
- Updated the macOS bootstrap to trust only the four third-party formulae in
  the Brewfile before running `brew bundle`, matching Homebrew's current
  formula trust requirement.
- Removed the unused `catppuccin/tap` and `jdx/tap` declarations instead of
  granting them unnecessary whole-tap trust.
- Resumed the Brewfile installation successfully through every dependency
  except the Tailscale cask, whose package installer requires an interactive
  administrator password.
- Verified after the operator installed Tailscale that `brew bundle check
--verbose --no-upgrade` reports the complete Brewfile satisfied.
- Replaced the removed `:TSUpdateSync` command with nvim-treesitter's current
  synchronous Lua API so parser-update failures propagate before the installer
  reports Neovim setup complete.
- Added a shared Neovim tree-sitter module with an explicit parser set,
  synchronous bootstrap installation, and highlighting through Neovim's current
  native tree-sitter API.
- Added idempotent macOS registration for the active mise-managed JDK through a
  stable `/Library/Java/JavaVirtualMachines/mise-java.jdk` symlink.
- Added first-launch and start-at-login setup for Syncthing and OrbStack while
  keeping Syncthing device and folder enrollment manual.
- Added an explicit Syncthing macOS login item because its stored
  `StartAtLogin` preference did not register a background item by itself.
- Confirmed OrbStack 2.2.2 starts successfully, but its incomplete first-run
  setup has not provisioned `~/.orbstack/bin/docker`; documented and surfaced
  the required in-app completion instead of creating a broken symlink.
- Verified after in-app setup that OrbStack provisioned its CLI links,
  `orbctl doctor` passes, and the Docker client reaches the OrbStack engine.
- Removed the empty retired mail-profile source directory so chezmoi no longer
  prompts about its deleted live counterpart.
- Added `sudo-touchid` and `pam-reattach` to the macOS Brewfile and configured
  the installer to enable persistent Touch ID authentication inside regular
  terminals and Zellij without the legacy Homebrew service.
- Verified the root-owned `/etc/pam.d/sudo_local` loads Homebrew's
  `pam_reattach.so` before `pam_tid.so`, and confirmed no legacy
  `sudo-touchid` Brew service is running.
- Added a content-keyed Chezmoi hook that installs Claude Code's managed policy
  on first apply and whenever the policy changes, leaving only the required
  administrator prompt interactive.
- Verified the installed Claude Code policy is valid JSON, root-owned with mode
  644, and byte-for-byte identical to the tracked managed policy.

### Remaining

- None.

### Caveats

- The CardDAV account requires a dedicated Fastmail app password during setup.
- Profile approval and password entry are interactive macOS steps.
- Homebrew 5 refuses to load formulae from untrusted third-party taps; the
  bootstrap now records formula-level trust instead of trusting full taps.
- Tailscale required an interactive administrator password and was installed
  manually by the operator.
- The bootstrap transcript pasted into chat contained the Atuin encryption key;
  it must be treated as exposed and rotated.
- The current `sudo-touchid` README documents `--yes`, but the Homebrew formula
  still packages version 0.5, which does not support that flag. The bootstrap
  therefore invokes the supported `--with-reattach` command.
