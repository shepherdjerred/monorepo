# mac-ci — native macOS Woodpecker agent

This directory provisions the Apple Silicon Woodpecker agent that runs the
native lanes. It is an active, serial native CI surface for QuotaBar, hkctl,
and TaskNotes; Linux verification and every Kubernetes-backed lane run on the
in-cluster agent instead.

The agent runs Woodpecker's **local backend**: it executes each step's commands
directly on the host rather than in a container, which is the only way Swift
and Xcode can run at all. Native lanes select it with `platform=darwin/arm64`,
which the Linux agents do not carry.

That label alone only steers mac work to the Mac. Keeping everything else
_off_ the Mac is the other half, and it runs the other way round: Woodpecker
will schedule a workflow onto any agent satisfying every label the workflow
asks for, so a container lane asking for nothing was eligible here. Every
generated workflow therefore also demands a `backend` — `local` for these
lanes, `kubernetes` for all the rest — which each agent advertises
automatically from its engine.

The host is deliberately separate from the personal Chezmoi workstation
layer. The repository defines its toolchain, native jobs validate that
toolchain, and jobs never install or upgrade host software.

## Execution and security boundary

Affected PR code runs natively as the logged-in `jerred` user in an unlocked
GUI session. This is not container or VM isolation: the code can access that
user's filesystem and any resources already available to the session.
Woodpecker checks each workflow out into a fresh directory under
`~/.woodpecker/builds`, but that does not change this trust boundary.

Native steps therefore have a deliberately narrow surface:

- They select the Mac by the `platform=darwin/arm64` and `backend=local` agent
  labels, and every container lane demands `backend=kubernetes` so it can never
  land here.
- Code from third-party forks never executes on the persistent GUI user. This
  is enforced at the repository level — Woodpecker's "Approvals for forked
  repositories" plus `ignore_forks` — rather than by a per-step guard.
- No Kubernetes pod, pod metadata, or secret grant is attached; the local
  backend creates no pod, so there is nothing to grant.
- All native jobs share the `macos-native` concurrency group with limit one.
- Every native job waits for Linux `verify`, has a timeout, and is a hard gate.
- Only one Apple Development identity is installed. Developer ID,
  notarization, release, iOS simulator, CocoaPods, Maestro, and device
  credentials are out of scope.

## What runs

| Lane               | Timeout | Work                                                                                         |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `quotabar-macos`   | 45 min  | Complete `verify:macos` suite                                                                |
| `hkctl-native`     | 20 min  | Swift test suite                                                                             |
| `tasknotes-native` | 90 min  | Swift binding verification, macOS verify/analyze, and all signed TaskNotes UI test scenarios |

The PR and main variants are one lane each: the selector decides whether a lane
runs, so there is no second step carrying a different gate.

When the TaskNotes UI tests fail, their `.xcresult` bundles are copied to
`~/.woodpecker/evidence/tasknotes-<pipeline number>/` on the Mac, because the
local backend deletes the job's checkout when it ends and the lane holds no
credentials to upload them anywhere. Bundles older than two weeks are pruned by
the next failing run.

Product paths select their own lane. Changes to the native pipeline,
toolchain, preflight, or this host configuration select both. Unrelated paths
select neither lane.

## First-time setup

### 1. Bootstrap packages and the agent

From a clean checkout on the Mac, run the host provisioner:

```bash
./packages/homelab/mac-ci/provision-host.sh
```

It reads the shared Woodpecker agent secret from 1Password without persisting
it, runs the package and agent bootstrap, installs/selects the pinned Xcode,
and validates the native prerequisites. Apple ID, administrator, FileVault,
signing, and Accessibility prompts remain interactive. To rerun only the
Xcode and validation phase after the package bootstrap has completed:

```bash
./packages/homelab/mac-ci/provision-host.sh --skip-bootstrap
```

The lower-level bootstrap can still be run directly when an explicit
credential reference or a different server endpoint is required:

```bash
WOODPECKER_SERVER="woodpecker-grpc:9000" \
  WOODPECKER_AGENT_SECRET="$(op read 'op://<vault>/<item>/WOODPECKER_AGENT_SECRET')" \
  ./packages/homelab/mac-ci/bootstrap.sh
```

`WOODPECKER_SERVER` is the gRPC endpoint as `host:port`, with no scheme. It is
the **tailnet** address, not `woodpecker.sjer.red`: the public hostname carries
only the web UI, webhooks, and the OAuth callback, because the agent endpoint
is guarded by nothing but the shared agent secret.

The bootstrap:

- installs `mise`, `xcodes`, XcodeGen, SwiftLint, coreutils, and Tailscale
  with Homebrew,
  plus the pinned `woodpecker-agent` release binary into `~/.local/bin`
  (Woodpecker ships no Homebrew formula, and the agent/server gRPC protocol is
  versioned, so a silently-upgraded agent would stop claiming jobs);
- installs the Bun and Rust versions pinned by the root `.mise.toml`;
- installs the `aarch64-apple-darwin` and `x86_64-apple-darwin` standard
  libraries needed for TaskNotes' universal macOS XCFramework;
- writes `~/.woodpecker/agent.env` (chmod 600 — it holds the agent secret) with
  `WOODPECKER_BACKEND=local`, the `platform=darwin/arm64` label the native
  lanes select on, and `WOODPECKER_MAX_WORKFLOWS=1`;
- loads the per-user `red.sjer.woodpecker-agent` LaunchAgent, which sources
  that env file and execs the agent;
- saves the original AC power profile and disables system, disk, and display
  sleep;
- disables idle screen saver activation and interactively disables password
  lock for the dedicated CI login session, preventing unattended signing from
  deadlocking behind a locked login keychain.

Re-running it is safe. Native jobs use a per-user Bun cache and explicitly
remove the Linux-only shared-cache and Turbo variables they inherit from the
generated workflow.

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
the CI environment, or a shell-history command.

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
. ci/scripts/macos-native-env.sh
TASKNOTES_UITEST_IDENTITY="$(bun --no-install ci/scripts/macos/macos-native-preflight.ts tasknotes)"
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
launchctl print "gui/$(id -u)/red.sjer.woodpecker-agent" | head -20
pmset -g custom
bun --no-install ci/scripts/macos/macos-native-preflight.ts quotabar
```

The service must be running, system/disk sleep must remain disabled, and the
GUI session must satisfy the native preflight. The agent should also appear
connected at <https://woodpecker.sjer.red/admin/agents>; its log is at
`~/.woodpecker/logs/agent.log`.

## Native preflight

`ci/scripts/macos/macos-native-preflight.ts` is read-only. Every job requires:

- Darwin on `arm64`;
- the exact Xcode from `.xcode-version` selected as a full Xcode installation;
- the Bun and Rust versions pinned by the root `.mise.toml`, selected through `mise`;
- both Rust standard-library targets required by TaskNotes' universal macOS XCFramework;
- XcodeGen and SwiftLint;
- Homebrew coreutils' `gtimeout` at `/opt/homebrew/bin/gtimeout`, which bounds
  every generated step (macOS has no `timeout`);
- permission for XCTest to enable Automation Mode without authentication;
- active FileVault and the CI user as the console user;
- at least 40 GiB free in the checkout filesystem;
- for TaskNotes only, exactly one valid Apple Development identity.

For TaskNotes, the preflight prints the discovered certificate fingerprint to
stdout. `mac:e2e:ci` requires that explicit value and passes it only to the UI
test runner's code-signing setting.

## Operations

The agent is a per-user LaunchAgent because UI automation, Accessibility trust,
and the login keychain all require the GUI user context.

If the Mac is powered off or waiting at FileVault login, matching hard jobs
cannot dispatch and the workflow sits queued until its timeout expires. There
is no separate dispatch watchdog: the Buildkite-era `macos-native-dispatch`
step polled Buildkite's job state to bound that wait, and it was retired rather
than ported — Woodpecker queues the workflow itself and the per-step timeout is
the bound. The practical consequence is that an offline Mac surfaces as a
pending check for up to the lane's timeout rather than after five minutes. Wake
and log in to the host, then restart the affected workflow; do not weaken the
steps or move signing material into a daemon context.

To restore the power profile and remove the agent:

```bash
launchctl bootout "gui/$(id -u)/red.sjer.woodpecker-agent"
rm ~/Library/LaunchAgents/red.sjer.woodpecker-agent.plist ~/.local/bin/woodpecker-agent
./packages/homelab/mac-ci/restore-power.sh
```

The restore script requires the exact pre-bootstrap profile saved in
`/var/db/buildkite-mac-ci-pmset-before`; it fails instead of guessing defaults.
That filename is historical — an already-provisioned Mac holds the only copy of
its pre-bootstrap power profile there, so renaming it would strand it.
