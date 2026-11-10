# macOS Fresh-Install Manual Steps

The automated installer restores the Homebrew bundle, chezmoi-managed files,
mise runtimes, shell tools, and the macOS preferences under
`~/.config/macos-defaults`. It deliberately stops short of credentials,
personal data, and approvals that macOS requires the user to make.

The recovery model is intentionally service-based: dotfiles restore machine
configuration, while Syncthing, Obsidian Sync, iCloud, and application-specific
cloud services restore user data. A full-machine backup is not required.

## Tailscale SSH

Every Mac is reached through Herdr over Tailscale SSH. The GUI Tailscale app
cannot run the Tailscale SSH server, so every profile uses the brew `tailscale`
formula with `tailscaled` installed as a system daemon; the installer runs
`sudo tailscaled install-system-daemon` when the daemon is absent. That command
copies the binary to `/usr/local/bin`, so after `brew upgrade tailscale` rerun
it from a local session; it restarts the daemon and drops Tailscale SSH
sessions.

At the console once, run `sudo tailscale up --ssh --hostname=<name>` and
approve the login. Keep macOS Remote Login off; Tailscale SSH serves port 22 on
the tailnet. The tailnet policy should `accept` rather than `check` your own
devices so Herdr sessions do not require periodic browser re-authentication.
From then on, `ssh <name>` and Herdr's `hc machine add <name>` reach the Mac.

Windows cannot run the Tailscale SSH server, so the Windows desktop keeps
OpenSSH Server and is addressed by its MagicDNS name. An agent host reaches it
with a dedicated `~/.ssh/herdr-desktop` key generated on that host; its public
half sits in the desktop's `administrators_authorized_keys` behind a `from=`
restriction to the host's tailnet address.

## Agent hosts

An agent host is a headless Mac for coding agents, driven from another machine
through Herdr over Tailscale SSH. Install it with
`DOTFILES_PROFILE=agent-host bash install_macos.sh`. The profile keeps every
formula and toolchain but only the casks in `.chezmoidata/agent-host.yaml`, and
skips Touch ID, Berkeley Mono, desktop app configuration, and Atuin sync.

At the console (or KVM) once:

1. Enable FileVault. Each reboot then needs a console unlock, which also logs
   in the user so Herdr core starts.
2. Run `sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1`.
3. Bring up Tailscale SSH as described in [Tailscale SSH](#tailscale-ssh).
4. Enroll the 1Password service account with
   `swift scripts/onepassword/enroll-service-account.swift` and choose
   **Always Allow** when Keychain asks, so headless reads never wait on a
   dialog. Do not sign in to the 1Password desktop app on an agent host.
5. Sign in to `gh` twice: as yourself, and with
   `GH_CONFIG_DIR=~/.config/gh-agent` for agent sessions.

From then on, `ssh <name>` and Herdr's `hc machine add <name>` reach the host
without the console.

An agent host keeps no credential files. Do not run `talosctl kubeconfig`,
`gcx login`, or `argocd login` there, and do not copy `~/.talos/config` or
`~/.aws/credentials` onto it. Toolkit brokers every credential at call time:

- `~/.kube/config` holds only the cluster address, its public CA (read at
  apply time through the service account), and the `admin@torvalds` context;
  kubectl obtains a client credential from `toolkit kube credential`.
- `~/.aws/config` gives the bucket-scoped `b2-velero`, `b2-postgres-wal`, and
  `b2-seaweedfs-backups` profiles, plus `seaweedfs` and `brim-sync`, a
  `credential_process` of `toolkit aws credential <profile>`.
- `~/.local/share/toolkit/shims` holds `talosctl`, `argocd`, `gcx`,
  `woodpecker-cli`, `temporal`, and `posthog-cli` shims that run the matching
  `toolkit` passthrough. Fish, bash, and zsh put that directory ahead of the
  mise shims and Homebrew.

Verify with `command -v talosctl` (resolves to the shim), `kubectl get nodes`,
and `aws --profile seaweedfs s3 ls`.

## Assistant hosts

An assistant host is a GUI Mac that a ChatGPT Dot uses as its connected
computer; `jobs` is the first. A Dot can use a Mac only while the ChatGPT app is
open there, and a ChatGPT account connects one Mac at a time. You administer
the host over Tailscale SSH and Herdr, with a KVM for the console.

Install it with `DOTFILES_PROFILE=assistant-host bash install_macos.sh`. The
profile installs only the taps, formulae, and casks in
`.chezmoidata/assistant-host.yaml`: ChatGPT, 1Password, Google Chrome,
Obsidian, Ghostty, and the shell and remote-administration tools. It carries no
coding agents, language runtimes, homelab CLIs, or credentials, and keeps
Atuin local-only. The `com.jerred.chatgpt` LaunchAgent starts ChatGPT at login
and reopens it within a minute if it quits.

At the console (or KVM) once:

1. Sign in with your Apple ID, turn on Messages in iCloud, and enable FileVault.
   Each reboot then needs a console unlock, which also logs in the user so
   ChatGPT and Herdr core start.
2. Run `sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1`, and set
   **Require password after screen saver begins or display is turned off** to
   **Never** so a Dot can keep using the unlocked session. FileVault still
   protects the disk at rest.
3. Bring up Tailscale SSH as described in [Tailscale SSH](#tailscale-ssh), then
   run `hc machine add <name> --install` from the Mac that drives Herdr.
4. Run `gh auth login`, then `chezmoi apply` so the CS 6035 workspace clones to
   `~/git/6035-workspace`.
5. Sign in to the 1Password app for your own use. Set it to lock after one
   minute and on screen lock. Do not install the 1Password CLI or browser
   extension; no agent gets the vault.
6. In Google Chrome, create a separate profile for the Dot and sign in to the
   sites it should browse. Install the AntiCaptcha plugin in that profile only:
   - Google removed it from the Chrome Web Store, so download the ZIP from
     [antcpt.com](https://antcpt.com/eng/download/google-chrome-options/manual-zip.html)
     (not the store's "Anti-Captcha Blocker Extension" or a mirror). Unzip it
     to `~/Library/Application Support/anticaptcha-plugin`.
   - In `chrome://extensions`, turn on **Developer mode**, choose **Load
     unpacked**, and select that folder.
   - Open the plugin's options, paste the anti-captcha.com API key next to
     the lock icon, and choose **Save**.
   - An unpacked plugin does not auto-update; replace the folder for a new
     version.
   - The plugin strips the `Content-Security-Policy` header from every site
     in the profile so it can inject its solver. Keep it out of profiles
     used for banking, primary email, or other high-stakes sites.
7. Sign in to Obsidian Sync and open the vault.
8. Sign in to ChatGPT. In the Dot's settings, under **Computers**, choose
   **Allow access** for this Mac, then grant the Accessibility, Screen
   Recording, and Automation prompts macOS shows.

Account-level ChatGPT connectors (for example the Monarch and Home Assistant
MCP servers) belong to the ChatGPT account, not to this Mac.

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
4. Run `claude auth login` if Claude Code usage should appear in the quota
   panel.
5. Bring up Tailscale SSH as described in [Tailscale SSH](#tailscale-ssh).
6. Sign in to GitHub CLI, Atuin, browsers, editors, and licensed apps as
   needed.
7. Approve the Fastmail Contacts profile in **System Settings > General >
   Device Management**, then enter a dedicated Fastmail Contacts app password
   when macOS requests it.
8. Run `sudo touch /private/var/tmp/.metadata_never_index`. Every other
   Spotlight exclusion is placed automatically on each `chezmoi apply` from
   `.chezmoidata/spotlight.yaml`, but this one is root-owned, so the apply
   script skips it rather than blocking on a password prompt and prints a
   reminder until it exists.
9. Complete the privacy checklist below, then test each affected feature.

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

| Settings area                      | Expected apps or action                                                                                    | Verify by                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Accessibility                      | BetterMouse, Middle, Swish, Rectangle Pro, and CleanShot X when requested                                  | Exercise mouse remapping, middle click, window gestures, window throw, and CleanShot annotation controls |
| Input Monitoring                   | BetterMouse, Middle, or Swish only if the app requests it for the configured input behavior                | Confirm the configured mouse and trackpad actions work in another app                                    |
| Screen & System Audio Recording    | CleanShot X; Discord or ChatGPT only when their screen-sharing features are used                           | Capture a display and, for optional sharing apps, complete one screen-share test                         |
| Camera & Microphone                | CleanShot X, Discord, or ChatGPT only for recording, calls, or voice features that are actually used       | Record a short local test or complete one test call, then confirm the indicator disappears               |
| Bluetooth                          | BetterMouse; Discord only when using a Bluetooth device through the app                                    | Confirm the intended device works without approving unrelated apps                                       |
| Automation & personal data         | ChatGPT only for each intentionally used app-control, Calendar, Reminders, Desktop, or location feature    | Run the specific requested action; leave every unused category denied                                    |
| Files & Folders / Full Disk Access | Syncthing only for selected protected folders; terminal or agent tools only for a deliberate workflow need | Confirm each intended protected folder is readable; do not grant broad access preemptively               |
| VPN, Local Network & Downloads     | Allow Local Network and Downloads only for an app that requests them for a feature in use                  | Reach one intended tailnet resource and test Taildrop only if it will be used                            |
| Browser extensions                 | Enable the 1Password extension and any intentionally retained Safari extensions                            | Confirm password fill works and each retained extension appears enabled                                  |
| Notifications                      | Choose per app after first launch                                                                          | Trigger one useful notification from each app whose notifications should remain enabled                  |

If an app was denied accidentally, remove or reset only that app's decision and
launch the feature again to receive a fresh prompt. Avoid resetting all privacy
decisions as part of routine setup.

## Final verification

- `chezmoi diff` contains no unexplained configuration drift.
- `brew bundle check --file="$HOME/.Brewfile" --no-upgrade` succeeds.
- `command -v bun | grep mise/shims` confirms bun still resolves through mise
  rather than a shadowing Homebrew copy.
- `gcx config check` exits zero and reports the `homelab` context online against
  the self-hosted Grafana.
- `toolkit woodpecker pipeline ls shepherdjerred/monorepo --limit 3`,
  `logcli labels`, and
  `promtool query instant "$PROMETHEUS_URL" 'count(up)'` all return live data.
- `temporal --profile homelab operator cluster health` reports `SERVING`, and
  `temporal config get --profile default` still points at `localhost:7233`.
- `toolkit tracker whoami --json` reports the native actor without credentials.
- `posthog-cli --version` succeeds, and
  `posthog-cli api call read-data-schema '{"query":{"kind":"events"}}'`
  returns the configured project's event schema through
  `POSTHOG_CLI_API_KEY`.
- `psql --version` resolves through the keg-only `libpq` on PATH, in both fish
  and `bash -lc`.
- `tailscale version` succeeds, `launchctl print system/com.tailscale.tailscaled`
  shows the daemon running, `tailscale debug prefs` reports `"RunSSH": true`,
  and the `tailscale-app` cask is **not** installed. Another tailnet device
  reaches this Mac with `ssh <name> hostname`.
- `cf --version` matches the pin in `~/.local/bin/cf`, and
  `env | grep -c '^CLOUDFLARE_API_TOKEN='` returns `0` so a bare `tofu apply`
  still fails closed without `op run`.
- `pinchtab health` succeeds with `PINCHTAB_CONFIG` pointing at the launchd
  daemon's config under `~/Library/Application Support/pinchtab/`.
- `lightpanda fetch --dump markdown https://example.com` returns the rendered
  Example Domain page as Markdown.
- `docling --version`, `docling-tools models download --help`,
  `tesseract --version`, and `ffmpeg -version` succeed; converting a
  representative PDF produces Markdown.
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
