# macOS Fresh-Install Manual Steps

The automated installer restores the Homebrew bundle, chezmoi-managed files,
mise runtimes, shell tools, and the macOS preferences under
`~/.config/macos-defaults`. It deliberately stops short of credentials,
personal data, and approvals that macOS requires the user to make.

The recovery model is intentionally service-based: dotfiles restore machine
configuration, while Syncthing, Obsidian Sync, iCloud, and application-specific
cloud services restore user data. A full-machine backup is not required.

## Before erasing the Mac

- Identify the authoritative sync service for every important data set and
  verify that each service reports synchronization is complete.
- Verify 1Password account and recovery access from another device.
- Commit and push every repository change that should survive, or deliberately
  decide that it is disposable.
- Confirm that another Syncthing device can authorize this Mac's replacement
  and reshare each intended folder. The old local device identity need not be
  preserved.
- Treat any important application data without an identified sync service as an
  unresolved exception before erasing the Mac.

Do not infer sync completeness merely because a client process is running.

## Before the automated installer

Download the licensed Berkeley Mono static TTF package and leave its extracted
directory under `~/Downloads`. The installer locates the directory through its
single `BerkeleyMono-Regular.ttf`, downloads the pinned Nerd Fonts patcher,
patches every TTF in that directory, and installs the results in
`~/Library/Fonts`. The licensed source fonts and generated fonts remain outside
the repository.

If the extracted fonts live elsewhere, set `BERKELEY_MONO_SOURCE_DIR` to that
directory when invoking `install_macos.sh`. The source directory must contain
the static desktop TTF files, not OTF, WOFF2, or variable fonts.

## After the automated installer

1. Sign in to 1Password and enable its CLI and SSH-agent integrations.
2. Re-run `chezmoi apply` so secret-backed templates can render.
3. Install full Xcode manually. The bootstrap installs only Xcode Command Line
   Tools.
4. Sign in to GitHub CLI, Tailscale, Atuin, browsers, editors, and licensed apps
   as needed.
5. Approve the Fastmail Contacts profile in **System Settings > General >
   Device Management**, then enter a dedicated Fastmail Contacts app password
   when macOS requests it.
6. Complete the privacy checklist below, then test each affected feature.

Syncthing and OrbStack are launched automatically and configured to start at
login. Syncthing still requires explicit authorization from another device and
selection of the folders that should be shared with this Mac. If `docker` is
not available after OrbStack launches, complete the setup shown in the OrbStack
app; `orbctl doctor --fix` cannot repair an installation whose Docker CLI has
not been provisioned yet.

Microsoft Office, OneDrive, Honorlock, LinearMouse, Orion, and Raycast are not
part of the desired machine profile. OrbStack itself is installed, but its
containers, images, and volumes are intentionally disposable.

The installer configures Touch ID for `sudo` through `/etc/pam.d/sudo_local`.
It includes `pam_reattach` so authentication also works inside Zellij and other
terminal multiplexers. Modern macOS preserves `sudo_local` across system
updates, so the legacy `sudo-touchid` Homebrew service is not enabled.

Chezmoi installs Claude Code's managed settings on the first apply and whenever
the tracked policy changes. This step prompts for administrator access because
Claude Code reads the policy from `/Library/Application Support/ClaudeCode`.

## Privacy-permission boundary

Privacy grants are not portable dotfiles. Apple supports declaring them with a
Privacy Preferences Policy Control payload only on a supervised Mac enrolled in
a device management service. On an unmanaged personal Mac, approvals remain
interactive. The built-in `tccutil` command can reset a decision so an app asks
again; it cannot grant access.

Do not copy or edit a TCC database, disable System Integrity Protection, or use
an unsigned configuration profile to bypass the prompts. Apple documents the
[managed PPPC payload](https://support.apple.com/guide/deployment/privacy-preferences-policy-control-payload-dep38df53c2a/web)
and the [manual Privacy & Security settings](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac).

## Privacy checklist

Grant only permissions needed for features you actually use.

| Settings area                      | Expected apps or action                                                                                    | Verify by                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Accessibility                      | BetterMouse, Middle, Swish, and CleanShot X when requested                                                 | Exercise mouse remapping, middle click, window gestures, and CleanShot annotation controls |
| Input Monitoring                   | BetterMouse, Middle, or Swish only if the app requests it for the configured input behavior                | Confirm the configured mouse and trackpad actions work in another app                      |
| Screen & System Audio Recording    | CleanShot X; Discord or ChatGPT only when their screen-sharing features are used                           | Capture a display and, for optional sharing apps, complete one screen-share test           |
| Camera & Microphone                | CleanShot X, Discord, or ChatGPT only for recording, calls, or voice features that are actually used       | Record a short local test or complete one test call, then confirm the indicator disappears |
| Bluetooth                          | BetterMouse; Discord only when using a Bluetooth device through the app                                    | Confirm the intended device works without approving unrelated apps                         |
| Automation & personal data         | ChatGPT only for each intentionally used app-control, Calendar, Reminders, Desktop, or location feature    | Run the specific requested action; leave every unused category denied                      |
| Files & Folders / Full Disk Access | Syncthing only for selected protected folders; terminal or agent tools only for a deliberate workflow need | Confirm each intended protected folder is readable; do not grant broad access preemptively |
| VPN, Local Network & Downloads     | Approve Tailscale; allow Local Network and Downloads only when direct connections or Taildrop need them    | Reach one intended tailnet resource and test Taildrop only if it will be used              |
| Browser extensions                 | Enable the 1Password extension and any intentionally retained Safari extensions                            | Confirm password fill works and each retained extension appears enabled                    |
| Notifications                      | Choose per app after first launch                                                                          | Trigger one useful notification from each app whose notifications should remain enabled    |

If an app was denied accidentally, remove or reset only that app's decision and
launch the feature again to receive a fresh prompt. Avoid resetting all privacy
decisions as part of routine setup.

## Final verification

- `chezmoi diff` contains no unexplained configuration drift.
- `brew bundle check --file="$HOME/.Brewfile" --no-upgrade` succeeds.
- `system_profiler SPFontsDataType` lists Berkeley Mono Regular, Bold, Oblique,
  and Bold Oblique from `~/Library/Fonts`.
- Automatic appearance, key repeat, Dock behavior, tap-to-click, and
  three-finger drag match the tracked defaults.
- The privacy feature checks above succeed.
- Full Xcode launches and `xcode-select -p` points at the intended developer
  directory after manual installation.
- `/usr/libexec/java_home -V` lists the active mise-managed JDK.
- `sudo -k && sudo true` requests Touch ID both in a regular terminal and in
  Zellij.
- `nvim --headless "+lua print(vim.inspect(require('nvim-treesitter').get_installed()))" +qa`
  lists the configured parser set.
- `orbctl doctor` reports no actionable errors and `docker version` reaches the
  OrbStack engine.
- Every authoritative sync service reports current, and the re-enrollment path
  for Syncthing and account-backed applications is available.
- Fastmail contacts appear in Contacts and a test contact change syncs in both
  directions.
