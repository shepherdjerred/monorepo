# mac-ci — native macOS Buildkite agent

This directory provisions the Apple Silicon Buildkite agent behind the
`macos` queue. The queue is an active, serial native CI surface for QuotaBar
and TaskNotes; Linux verification and every Kubernetes-backed lane remain on
the default queue.

The host is deliberately separate from the personal Chezmoi workstation
layer. The repository defines its toolchain, native jobs validate that
toolchain, and jobs never install or upgrade host software.

## Execution and security boundary

Affected PR code runs natively as the logged-in `jerred` user in an unlocked
GUI session. This is not container or VM isolation: the code can access that
user's filesystem and any resources already available to the session.
`git-clean-flags=-ffxdq` cleans each checkout, but it does not change this
trust boundary.

Native steps therefore have a deliberately narrow Buildkite surface:

- `agents.queue` is exactly `macos`.
- Native PR steps require `build.pull_request.repository.fork` to be false, so
  code from third-party forks never executes on the persistent GUI user.
- No Kubernetes plugin, pod metadata, or cluster-secret environment is
  attached.
- All native jobs share `concurrency_group: monorepo/macos-native` with
  concurrency one.
- Every native job waits for Linux `verify`, has a timeout, and is a hard gate.
- Only one Apple Development identity is installed. Developer ID,
  notarization, release, iOS simulator, CocoaPods, Maestro, and device
  credentials are out of scope.

## What runs

| Lane               | PR step / main step                             | Timeout | Work                                                                                         |
| ------------------ | ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `quotabar-macos`   | `quotabar-macos-pr` / `quotabar-macos-main`     | 45 min  | Complete `verify:macos` suite                                                                |
| `tasknotes-native` | `tasknotes-native-pr` / `tasknotes-native-main` | 90 min  | Swift binding verification, macOS verify/analyze, and all signed TaskNotes UI test scenarios |

Product paths select their own lane. Changes to the native pipeline,
toolchain, preflight, or this host configuration select both. Unrelated paths
select neither lane.

## First-time setup

### 1. Bootstrap packages and the agent

From a clean checkout on the Mac, run the host provisioner:

```bash
./packages/homelab/mac-ci/provision-host.sh
```

It reads the existing Buildkite agent token from 1Password without persisting
it, runs the package and agent bootstrap, installs/selects the pinned Xcode,
and validates the native prerequisites. Apple ID, administrator, FileVault,
signing, and Accessibility prompts remain interactive. To rerun only the
Xcode and validation phase after the package bootstrap has completed:

```bash
./packages/homelab/mac-ci/provision-host.sh --skip-bootstrap
```

The lower-level bootstrap can still be run directly when an explicit token
reference or environment is required:

```bash
BUILDKITE_AGENT_TOKEN="$(op read 'op://<vault>/Buildkite Agent Token/<field>')" \
  ./packages/homelab/mac-ci/bootstrap.sh
```

The bootstrap:

- installs `buildkite-agent@3`, `mise`, `xcodes`, XcodeGen, SwiftLint, and
  Tailscale with Homebrew;
- installs the Bun and Rust versions pinned by the root `.mise.toml`;
- installs the `aarch64-apple-darwin` and `x86_64-apple-darwin` standard
  libraries needed for TaskNotes' universal macOS XCFramework;
- configures the per-user Buildkite LaunchAgent on `queue=macos`, pinning
  `shell="/bin/bash -e -c"` so the native steps that source
  `macos-native-env.sh` get the bash guarantee Kubernetes steps get from
  `BUILDKITE_SHELL`;
- saves the original AC power profile and disables system, disk, and display
  sleep;
- disables idle screen saver activation and interactively disables password
  lock for the dedicated CI login session, preventing unattended signing from
  deadlocking behind a locked login keychain.

Re-running it is safe. Native jobs use a per-user Bun cache and explicitly
remove the Linux-only shared-cache and Turbo variables they inherit from the
pipeline document.

### 2. Join the tailnet

Enrollment requires interactive authentication:

```bash
sudo tailscaled install-system-daemon
sudo tailscale up
```

The tailnet is an administration path, not a requirement exposed to native
job code.

### 3. Install the pinned Xcode

The root [`.xcode-version`](../../../.xcode-version) is authoritative. Install
its Apple Silicon build with [xcodes](https://github.com/XcodesOrg/xcodes),
select it, complete Apple's first-launch setup, and immediately remove the
download credentials:

```bash
XCODE_VERSION="$(tr -d '[:space:]' < .xcode-version)"
xcodes install "$XCODE_VERSION" --architecture arm64
xcodes select "$XCODE_VERSION"
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
sudo /usr/bin/automationmodetool enable-automationmode-without-authentication
xcodes signout
xcodebuild -version
xcode-select -p
/usr/bin/automationmodetool
```

The final checks must report the pinned Xcode, a full
`Xcode.app/Contents/Developer` path rather than Command Line Tools, and enabled
an Automation Mode configuration that does not require user authentication.
`automationmodetool` lets XCTest enable UI automation without an expiring
password grant. This is separate from the UI runner's Accessibility grant
below and from debugger authorization managed by `DevToolsSecurity`.

### 4. Enable FileVault and configure the login session

Enable FileVault in System Settings and choose a personal recovery key rather
than iCloud recovery. Before rebooting, store that key in a dedicated
1Password item used only for this Mac. Do not place the key in this repository,
the Buildkite environment, or a shell-history command.

Keep automatic login disabled. FileVault requires a human to unlock the disk
and log in after a cold boot, so the native agent is intentionally offline
until that happens. The bootstrap prompts for the local account password to
set the screen saver and password lock to **Never**, and it keeps the display,
system, and disk awake while the node is online.

This unlocked session is part of the accepted native-code security boundary.

### 5. Issue the CI Apple Development certificate

In Keychain Access, use Certificate Assistant → Request a Certificate From a
Certificate Authority to create a CSR on this Mac. Issue one dedicated
**Apple Development** certificate from the Apple Developer portal and import
it into the `jerred` login keychain. The private key must remain in that
keychain; do not export it and do not install Developer ID certificates.

Verify that exactly one valid identity is visible:

```bash
security find-identity -v -p codesigning
```

The native preflight rejects zero identities, multiple identities, expired
identities, and distribution identities for TaskNotes.

### 6. Approve the signed TaskNotes UI runner

From a clean checkout, discover the certificate fingerprint through the same
preflight CI uses and run the UI suite once:

```bash
. .buildkite/scripts/macos-native-env.sh
TASKNOTES_UITEST_IDENTITY="$(bun --no-install .buildkite/scripts/macos-native-preflight.ts tasknotes)"
export TASKNOTES_UITEST_IDENTITY
bun --no-install run --cwd packages/tasknotes-macos mac:e2e:ci
```

The first hotkey scenario fails with an actionable Accessibility message.
Open System Settings → Privacy & Security → Accessibility and approve the
generated `TaskNotesUITests-Runner`. Then clean the derived data and pass the
complete suite twice:

```bash
xcodebuild -project packages/tasknotes-macos/TaskNotes.xcodeproj \
  -scheme TaskNotes -derivedDataPath packages/tasknotes-macos/.build/xcode clean
bun --no-install run --cwd packages/tasknotes-macos mac:e2e:ci
xcodebuild -project packages/tasknotes-macos/TaskNotes.xcodeproj \
  -scheme TaskNotes -derivedDataPath packages/tasknotes-macos/.build/xcode clean
bun --no-install run --cwd packages/tasknotes-macos mac:e2e:ci
```

Two clean signed runs prove that the TCC grant follows the stable certificate
instead of an ad-hoc build hash.

### 7. Reboot acceptance

Reboot once. Confirm the agent remains offline at the FileVault login screen,
then manually unlock and log in. After login, confirm:

```bash
brew services info buildkite-agent@3
pmset -g custom
bun --no-install .buildkite/scripts/macos-native-preflight.ts quotabar
```

The service must be running, system/disk sleep must remain disabled, and the
GUI session must satisfy the native preflight.

## Native preflight

`.buildkite/scripts/macos-native-preflight.ts` is read-only. Every job requires:

- Darwin on `arm64`;
- the exact Xcode from `.xcode-version` selected as a full Xcode installation;
- the Bun and Rust versions pinned by the root `.mise.toml`, selected through `mise`;
- both Rust standard-library targets required by TaskNotes' universal macOS XCFramework;
- XcodeGen and SwiftLint;
- permission for XCTest to enable Automation Mode without authentication;
- active FileVault and the Buildkite user as the console user;
- at least 40 GiB free in the checkout filesystem;
- for TaskNotes only, exactly one valid Apple Development identity.

For TaskNotes, the preflight prints the discovered certificate fingerprint to
stdout. `mac:e2e:ci` requires that explicit value and passes it only to the UI
test runner's code-signing setting.

## Operations

The Buildkite agent is a per-user LaunchAgent because UI automation,
Accessibility trust, and the login keychain all require the GUI user context.
If the Mac is powered off or waiting at FileVault login, matching hard jobs
cannot dispatch. The PR-side dispatch watchdog fails the aggregate required
status after five idle minutes instead of leaving it pending indefinitely. Its
clock pauses while a native job from any build is running on the serial queue,
and it stays active through this build's final automatic-retry attempts. Wake
and log in to the host, then retry the affected jobs; do not weaken the steps
with `soft_fail` or move signing material into a daemon context.

To restore the power profile and remove the agent:

```bash
brew services stop buildkite/buildkite/buildkite-agent@3
brew uninstall buildkite/buildkite/buildkite-agent@3
./packages/homelab/mac-ci/restore-power.sh
```

The restore script requires the exact pre-bootstrap profile saved in
`/var/db/buildkite-mac-ci-pmset-before`; it fails instead of guessing defaults.
