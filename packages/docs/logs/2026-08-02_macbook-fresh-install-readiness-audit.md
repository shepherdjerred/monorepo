---
id: macbook-fresh-install-readiness-audit-2026-08-02
type: log
status: complete
board: false
---

# MacBook Fresh-Install Readiness Audit

## Question

Does the chezmoi source under `packages/dotfiles/` contain enough declarative
state and bootstrap automation to reproduce the current Mac after wiping it?

## Audit Scope

- Bootstrap entrypoint and dependency ordering
- Installed command-line tools and GUI applications
- Managed configuration compared with current live state
- Secrets, credentials, keys, and recovery prerequisites
- macOS preferences and privileged/manual setup
- User data and application state that dotfiles intentionally should not own

## Result

Not quite. Under the intended recovery model, synchronized services are the
source of truth for user data and dotfiles are the source of truth for machine
configuration. The absence of a conventional machine backup is therefore not a
blocker by itself. The dotfiles can reconstruct much of the shell, CLI, editor,
and selected application configuration after the missing prerequisites are
supplied, but they do not yet reconstruct the full desired software inventory,
all bootstrap side effects, privileged approvals, or every intended application
configuration.

Use the repository together with a completed-sync check as the go/no-go signal
for a wipe.

## What Is Already Covered Well

- The public `shepherdjerred/monorepo` can be cloned anonymously, so obtaining
  the bootstrap source does not depend on GitHub authentication.
- `install_macos.sh` installs Xcode Command Line Tools, Homebrew, chezmoi, the
  tracked Brew bundle, mise runtimes, Fisher plugins, Neovim plugins, bat
  themes, and fish as the login shell.
- Chezmoi declares 749 target entries spanning shell configuration, Git,
  Codex/Claude agent resources, editors, Kubernetes/Talos/Argo CD, AWS, and
  selected application preferences.
- Seven secret-bearing templates contain 22 1Password lookups. AWS, Kubernetes,
  Talos, Argo CD, remote-cache, and shell API credentials can therefore be
  reconstructed after 1Password is installed and unlocked.
- SSH uses the 1Password SSH agent. The live machine has no local SSH private-key
  files and no GPG secret keys, which reduces local key material that would
  otherwise require a separate export.
- FileVault is currently enabled.
- Both macOS installer scripts pass `bash -n`; `install_macos.sh` also passes the
  installed ShellCheck version.
- The follow-up desired-state update captures automatic appearance, key-repeat,
  Dock, tap-to-click, and three-finger-drag preferences.
- The tracked application set now uses BetterMouse and excludes LinearMouse,
  Orion, and Raycast.

## Blocking Gaps

### Sync-based recovery needs a closure check

- The intended design does not rely on Time Machine or a full-machine backup;
  `tmutil destinationinfo` reporting zero destinations is expected, not a gap.
- Syncthing is running with five configured folders. Its local device identity
  and folder/peer definitions are not chezmoi-managed, so a fresh Mac must be
  enrolled as a new device and have the intended folders shared back to it.
- iCloud Drive, Obsidian Sync, Syncthing, and any application-specific cloud
  service remain authoritative for their data. Before erasure, each service
  needs to report that synchronization is complete; a running process alone is
  not that proof.
- Four repositories were found in the bounded `~/git` scan. `monorepo` and
  `opencode-quota` have uncommitted changes; `opencode-quota` has modifications
  to `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
- Local-only working-tree changes are outside both dotfiles and sync services;
  they must be committed and pushed or intentionally discarded.
- Documents, media, application databases, browser profiles, and mail stores are
  intentionally absent from dotfiles. Anything important in those categories
  needs a named synchronization owner; anything without one is considered
  disposable under this recovery model.

### The tracked package inventory is stale

- After the desired-state update, the tracked `.Brewfile_darwin` contains 6
  taps, 51 formulae, 28 casks, and no Mac App Store entries.
- A current `brew bundle dump` already exists at
  `~/.local/share/chezmoi/.Brewfile_darwin` with 12 taps, 83 formulae, 38 casks,
  and 6 Mac App Store entries. It is not the configured chezmoi source.
- `bin/executable_write_brewfile.sh` hard-codes the default
  `~/.local/share/chezmoi` directory even though `chezmoi source-path` is
  `~/git/monorepo/packages/dotfiles`. This is the direct reason the export did
  not update the tracked file.
- The follow-up update removes the three absent casks—LinearMouse, Orion, and
  Raycast—and declares the installed BetterMouse replacement.
- The live environment has 31 top-level formulae absent from the tracked file,
  including Buildkite, Dagger, Gitleaks, Lefthook, PinchTab, Swift tooling,
  Temporal, Trivy, media tooling, and OpenCode. It also has 10 undeclared casks,
  including Android Studio, Claude Desktop, IntelliJ IDEA, MacTeX, TablePlus,
  and Zed.
- All six installed Mac App Store apps are absent from the tracked Brewfile.
  Full Xcode remains an intentional manual install. Microsoft Office, OneDrive,
  and Honorlock are explicitly excluded from the desired machine profile.

### Managed source and live state have drifted

The non-secret `chezmoi verify` exits 1. `chezmoi status --skip-secrets` reports
target drift in:

- `.agents/skills/argocd-app-patterns/SKILL.md`
- `.codex/config.toml`
- `.gitconfig`
- `Library/Application Support/Cursor/User/settings.json`
- the home `package.json`

The seven secret-bearing templates were deliberately excluded from this
non-interactive comparison, so they still require an unlocked 1Password-backed
verification.

### The macOS bootstrap can report success while incomplete

- The first chezmoi apply runs before the Brewfile installs 1Password CLI. Both
  the first apply and the post-Brew apply tolerate failures, and the script still
  prints a success message. A fresh Mac also needs a manual 1Password sign-in;
  the installer neither performs nor verifies it.
- `run_once_after_install-pinchtab-daemon.sh.tmpl` exits successfully when
  `pinchtab` is absent. Because PinchTab is also absent from the tracked
  Brewfile, chezmoi can permanently record the run-once script as complete
  without installing the daemon.
- The default-app and dark-notify LaunchAgent scripts also exit successfully
  before `duti` and `dark-notify` exist. The post-Brew apply does not retrigger
  unchanged `run_onchange` scripts, and `install_macos.sh` explicitly repairs
  only the `macos-defaults` case.
- Claude Code's user settings seed and root-owned managed policy have a correct
  manual procedure in `claude-managed/README.md`, but `install_macos.sh` never
  invokes it.
- Mail profiles, Gmail, Gatekeeper approvals, application logins/licenses,
  1Password, Apple ID, Tailscale, and privacy/accessibility permissions all
  require manual action. `MACOS_FRESH_INSTALL.md` now consolidates those steps,
  and the installer warns that they remain, but there is not yet an automated
  completion gate.
- The package tests cover the Git-cleanup utility, not a fresh-home/bootstrap
  acceptance test.

## Reproducibility Limits

- Mise specifies `latest`, `lts`, and `nightly` for most runtimes. Homebrew casks
  and formulae are also unpinned. The setup targets a current-equivalent machine,
  not the same versions that are installed today.
- Ten macOS defaults files are now tracked, including global appearance and key
  behavior, Dock, and built-in/current-host trackpad preferences. Menu bar,
  screenshots, hostname, login items, FileVault recovery, TCC/privacy grants,
  and most application preferences remain outside the declarative state.
- Nine live `~/.config` roots are unmanaged. Some are correctly machine-local
  authentication/runtime state. Raycast is now explicitly obsolete; Copilot,
  JGit, Temporal, Syncthing, and rclone recovery behavior is not documented.
- Four Berkeley Mono font files are installed in `~/Library/Fonts`; the repo
  contains only a patch script and cannot reinstall the licensed font files.
- Six of seven user LaunchAgents are not managed by chezmoi. Most may be
  recreated by their owning apps, but the bootstrap does not verify that.

## Detailed Application and Configuration Matrix

### Installation coverage

The live application scan found 47 app bundles across `/Applications` and
`~/Applications`:

| Classification         | Count | Meaning                                                                                                                      |
| ---------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------- |
| Tracked install        |    25 | Present in the updated Brewfile after accounting for Tailscale's package-style cask and BetterMouse                          |
| Current dump only      |    14 | Installed and present in the misplaced current Brew dump, but absent from the repository                                     |
| No declarative mapping |     8 | Safari is part of macOS and Claude's URL handler is generated; the other six are one manual prerequisite and five exclusions |

Of the six application bundles without an install mapping, Xcode is an
intentional manual prerequisite; Honorlock, OneDrive, and the three Microsoft
Office applications are intentionally excluded. Git Credential Manager and
MacTeX are two additional installed casks that do not create ordinary app
bundles and exist only in the misplaced dump.

The updated desired state replaces LinearMouse with BetterMouse and removes
Orion and Raycast. Raycast configuration remains on the current Mac as
unmanaged stale state, and a stale Contexts login item and tracked Contexts
preferences remain even though Spotlight finds no installed Contexts app.

### Application-level recovery

| Area                             | Install coverage           | Configuration/state gap                                                                                                                                        |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1Password                        | Tracked                    | Account sign-in and recovery material are external prerequisites; local CLI/app state is intentionally unmanaged                                               |
| Codex CLI                        | Tracked                    | Config is tracked but drifted; `~/.codex/auth.json` exists locally and is correctly untracked, so reauthentication is required                                 |
| Claude Code                      | Tracked                    | Managed policy and user seed are versioned but manually installed; authentication is not restored                                                              |
| Claude Desktop                   | Current dump only          | `claude_desktop_config.json` exists and is explicitly ignored; MCP/server configuration must be recovered securely or rebuilt                                  |
| GitHub CLI                       | Tracked                    | Host/user/protocol are tracked, but the token is in local Keychain state; a fresh machine needs `gh auth login`                                                |
| Cursor                           | Tracked                    | User settings and MCP config are tracked, but settings drifted and all 10 installed extensions are undeclared                                                  |
| Ghostty                          | Tracked                    | Primary config is tracked; shell integration still depends on the rest of the bootstrap                                                                        |
| Sublime Text                     | Tracked                    | Preferences and two Package Control packages are tracked; broader plugin/session state is not                                                                  |
| Zed                              | Current dump only          | Settings are tracked even though installation is absent from the tracked Brewfile                                                                              |
| Neovim                           | Tracked                    | Plugin declarations are tracked, but there is no `lazy-lock.json`; a rebuild resolves current plugin versions                                                  |
| Android Studio and IntelliJ IDEA | Current dump only          | IDE settings/plugins and Android SDK components are unmanaged; installed SDK state includes platforms, system images, emulator, NDK, and build tools           |
| Xcode                            | Intentional manual install | Full Xcode and any required simulator runtimes are installed manually after the automated bootstrap                                                            |
| Browsers and Safari extensions   | Mixed tracked/current-dump | Chrome, Firefox, and Safari profiles, bookmarks, extensions, enablement, certificates, and sign-ins are unmanaged; the six Safari extension apps are dump-only |
| Anki                             | Tracked                    | Local `Anki2` data exists outside dotfiles; recovery relies on AnkiWeb being fully synchronized                                                                |
| Obsidian                         | Tracked                    | Application state is unmanaged; vault and plugin data recovery relies on the configured Obsidian Sync or Syncthing source                                      |
| NetNewsWire                      | Tracked                    | Default-handler setup is declared, but feed/account/read state relies on application/iCloud sync                                                               |
| MailMate                         | Tracked                    | Only default-app handling is declared. MailMate account, rules, bundles, and local state are unmanaged; tracked mail profiles configure Apple Mail instead     |
| TablePlus                        | Current dump only          | Connections, workspace state, and Keychain credentials are unmanaged                                                                                           |
| OrbStack                         | Tracked                    | The application is restored; VM, container, image, and volume state is intentionally disposable                                                                |
| Syncthing                        | Tracked                    | Identity and peer/folder definitions are unmanaged; reinstalling requires enrolling a new device and resharing the intended folders                            |
| Tailscale                        | Tracked package-style cask | VPN identity/login and system-extension approval are manual                                                                                                    |
| CleanShot                        | Tracked                    | Preferences, license/account state, login behavior, and Screen Recording/Accessibility approval are not captured                                               |
| BetterMouse/Middle/Swish         | Tracked                    | Middle has partial preferences and login behavior; Swish has one preference; BetterMouse has no source configuration. Input/Accessibility approvals are manual |
| IINA/Keka/Affinity               | Tracked                    | Selected IINA preferences and file associations are declared; the applications' broader settings, plugins, licenses, and account state are not                 |
| Prism Launcher                   | Current dump only          | Launcher instances, accounts, mods, and local data exist outside chezmoi                                                                                       |
| Microsoft Office and OneDrive    | Excluded                   | Not part of the desired machine profile                                                                                                                        |
| Aptakube                         | Tracked                    | It can consume the tracked Kubernetes config after 1Password renders it, but app preferences/license state are not captured                                    |
| MacTeX                           | Current dump only          | Distribution installation is recoverable from Brew; extra TeX packages and user configuration have no manifest                                                 |

### macOS and peripheral configuration

The following active preferences were read from the live Mac and are now
captured in the source:

- Automatic light/dark appearance
- Press-and-hold disabled for keyboard input
- Dock auto-hide, 92-point tile size, and recent applications disabled
- Tap-to-click and three-finger drag

The current system also has Gatekeeper enabled, FileVault enabled, automatic
update checking enabled, Rosetta installed, the application firewall disabled,
and firewall stealth mode disabled. These are observations, not enforced desired
state; the installer relies on macOS defaults and manual setup.

Seven login items are configured: BetterMouse, Middle, Contexts, Swish,
OrbStack, CleanShot X, and FigmaAgent. Only Middle's login preference is
declared. One printer is configured and has no restore path. Display layout,
Bluetooth pairings, Wi-Fi/VPN state, notification permissions, menu-bar layout,
energy settings, hostname, Touch ID, and other hardware/user settings are also
outside the dotfiles.

The current Markdown, MP4, and ZIP handlers are Sublime Text, IINA, and Keka as
intended. This does not remove the fresh-install ordering bug that can skip the
handler script when `duti` is initially unavailable.

macOS privacy grants cannot be copied as ordinary dotfiles. Apple's PPPC payload
requires a supervised Mac enrolled in device management, while `tccutil` only
resets decisions. `MACOS_FRESH_INSTALL.md` therefore tracks an explicit manual
checklist for Accessibility, Input Monitoring, Screen Recording, Full Disk
Access, browser extensions, VPN approval, and notifications without attempting
to bypass TCC.

### Developer tooling and service state

- Cursor has 10 installed extensions and no tracked extension manifest.
- Bun has two global packages, `figma-use` and `knip`, neither declared by the
  dotfiles. Cargo has `cargo-deny` in addition to the tracked `typeshare` tool.
- The active Node installation reports only `npm` globally even though
  `.default-npm-packages` lists six additional tools. The declared list is not a
  verified representation of the live global environment.
- The `gh stack` extension and Fisher plugin list are correctly declared.
- Neovim plugins and most globally configured mise runtimes are floating rather
  than locked. The monorepo root pins its own active toolchain, but the global
  dotfiles profile does not reproduce historical installed versions.
- OrbStack's current containers, images, volumes, writable layers, and build
  cache are explicitly disposable and are not wipe-readiness blockers.
- There is no user crontab. The dark-notify, PinchTab, and Syncthing LaunchAgents
  are currently loaded; that confirms current operation, not fresh-install
  reproducibility.
- Live, unmanaged configuration roots include GitHub Copilot, JGit, mpv,
  Raycast, rclone, Temporal, 1Password, and the 1Password CLI. Raycast is
  explicitly obsolete; some others are correctly local authentication/runtime
  state, but the remaining roots have no documented restore decision.

## Recommended Path to Wipe-Ready

1. Close the sync inventory before any wipe: name the authoritative service for
   each important data set, verify every service reports fully synchronized,
   and commit/push every repository change that should survive. Record the
   Syncthing re-enrollment and folder-sharing steps; preserving the old device
   identity is not required when the new Mac can be enrolled normally.
2. Verify access to the 1Password account and recovery material from a separate
   device. Record the Apple ID, software licenses, Tailscale login, and other
   manual authentication prerequisites in a private recovery checklist.
3. Fix `write_brewfile.sh` to write to the configured chezmoi source and
   reconcile the remaining formulae, casks, and Mac App Store apps. The stale
   LinearMouse/Orion/Raycast and manual Xcode/MS/Honorlock decisions are now
   resolved.
4. Reorder the bootstrap so dependencies exist before their chezmoi scripts run.
   Missing prerequisites must fail rather than mark run-once/onchange work as
   complete. Make the final installer result distinguish `complete` from
   `manual action required`.
5. Integrate the Claude managed-settings bootstrap and turn the new manual
   setup/privacy checklist into a completion gate after validating it on a
   disposable user or spare Mac.
6. Add a safe fresh-home acceptance test plus a disposable-user or spare-Mac
   rehearsal. The rehearsal should prove both dotfile reconstruction and
   rehydration from the selected synchronization services.

## Verification Performed

- `chezmoi doctor`
- `chezmoi managed`
- `chezmoi --skip-secrets --no-tty status --exclude=scripts`
- `chezmoi --skip-secrets --no-tty verify --exclude=scripts`
- `brew bundle check --file=packages/dotfiles/.Brewfile_darwin --no-upgrade --verbose`
- Live Brew formula/cask/tap and Mac App Store comparison
- Installed `/Applications` comparison against Brew cask artifacts
- Application bundle/install-source inventory, including package-style casks
- Targeted application-data and authentication-state existence checks without
  reading secret contents
- Cursor, GitHub extension, global npm/Bun/Cargo/uv tool inventory
- GitHub CLI authentication-source check, confirming current credentials are in
  the macOS keyring rather than the tracked hosts file
- macOS global/Dock/trackpad, security, login-item, printer, SDK, simulator, and
  default-handler inspection
- Docker/OrbStack container, volume, Compose, and disk-state inspection
- `bash -n` for both bootstrap scripts and ShellCheck for `install_macos.sh`
- Read-only Time Machine, FileVault, Syncthing, iCloud/OneDrive process, key,
  font, LaunchAgent, and bounded repository-state checks
- Apple PPPC documentation and the local `tccutil(1)` contract
- Targeted installed-app usage descriptions for the privacy checklist
- Dry-run validation of all tracked `macos-defaults` YAML
- Alternate-source chezmoi apply and verification for the updated live Brewfile
  and four new live defaults files
- Disposable-home render comparison for the Brewfile and defaults files
- Focused dotfiles build, typecheck, 10 tests, and lint
- Current link, Prettier, Markdownlint, docs-model, shell, and diff checks

The initial audit did not install or alter anything. The follow-up applied only
the updated Brewfile and four non-secret defaults YAML files to their live
chezmoi targets. It did not install/uninstall packages, invoke a defaults
mutation, read a secret, delete application data, or modify the TCC database.

Targeted Prettier and Markdownlint validation pass. The isolated worktree also
passes `bun run check-todos`; the original main-checkout rerun was obscured by
concurrent edits that remain untouched in the user's checkout.

## Session Log — 2026-08-02

### Done

- Audited the declared dotfiles/bootstrap source against the live Mac.
- Identified the Brew export path bug, current manifest drift, five chezmoi
  target mismatches, bootstrap-order failures, and sync re-enrollment gaps.
- Recorded a prioritized path from the current partial bootstrap to a wipe-ready
  recovery system in this log.
- Extended the audit with an application install/config/state matrix, active
  macOS preferences, login items, printer state, editor extensions, global
  packages, SDKs, and OrbStack volumes.
- Reconciled the app decisions by tracking BetterMouse and removing
  LinearMouse, Orion, Raycast, and their tracked stale configuration.
- Captured the active automatic-appearance, key-repeat, Dock, tap-to-click, and
  three-finger-drag preferences with immediate process refreshes on change.
- Added and validated a least-privilege privacy recovery checklist that keeps
  Apple-required approvals interactive.
- Applied and verified the five changed managed targets against the live home
  directory without installing or uninstalling software.
- Published the verified changes as draft pull request #1959.
- Clarified that synchronized services, rather than a conventional backup, own
  user-data recovery; only sync completion and re-enrollment need gating.

### Remaining

- Verify the published pull request's current-head Buildkite and review state.
- Reconcile the remaining undeclared software and bootstrap-order gaps in
  follow-up work.
- Run the manual permission checklist and full restore rehearsal on a disposable
  user or spare Mac before approving a real wipe.

### Caveats

- Secret-backed templates were skipped to avoid interactive 1Password access and
  accidental secret exposure; they need a separate unlocked verification.
- The audit did not inspect private content or independently prove that each
  configured synchronization service is fully current.
- Installed-but-undeclared software may be intentional; reconciliation requires
  deciding desired state rather than blindly copying every installed package.
- The repository scan was bounded to `.git/config` files within five levels of
  `~/git`; other local repositories or worktrees may exist.
- Application classification is based on declared install sources, managed path
  coverage, and targeted live-state checks. A named and completed sync service,
  rather than mere application support for sync, is the recovery boundary.
- Keychain, TCC databases, browser contents, app databases, and Claude Desktop
  configuration contents were not read because they may contain credentials or
  private user data.
- Apple does not support pre-granting these privacy permissions from ordinary
  dotfiles on an unmanaged Mac; the tracked checklist records intent, not grant
  state.
- Existing local Raycast and LinearMouse data was left in place rather than
  deleted; it is no longer part of the managed fresh-install state.
