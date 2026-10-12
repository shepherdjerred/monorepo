# tasks-for-obsidian

**Facet**, the standalone iOS SwiftUI app, shares the Rust engine and Apple host
with [`tasknotes-macos`](../tasknotes-macos). It opens a supported local vault
folder as an independent private copy or creates an app-private replica of an
existing Obsidian Sync vault. Importing preserves the original folder and does
not synchronize later edits with it; interrupted imports can be retried.
No TaskNotes server is required. `tasks-for-obsidian` remains the workspace name.

First-party code is GPL-3.0-only. The native bundle contains the exact repository
[license text](../../LICENSE) and separate notices for its locked dependencies.

The registered app identity, App Group, widget extension and task App Intents are preserved. Vault credentials live in Keychain;
the App Group contains only bounded widget snapshots and action requests.
The shared runtime owns task interpretation, queries, durable mutations,
conflicts, and Sync state. Native hosts own transport and filesystem capability.
The former React Native sources and tests remain regression references while
equivalent native feature acceptance is completed; the release product is the
SwiftUI target generated from `ios/project.yml`.

Quick-add App Intents durably queue the selected vault, title and immutable
clock context in the App Group, then open the app. Rust interprets the capture;
the app acknowledges it only after an applied receipt and durable observation.
A selected-vault change does not redirect an already queued capture.

The native background task uses the declared Sync identifier and a bounded
attempt over persisted checkpoints and uploads. OS expiration cancels the
worker; opening the app resumes foreground sessions. Background scheduling is
best effort and does not guarantee a sync interval. Widgets refresh from the
Rust-derived projection after foreground capture and completed background work.

Task reminders use explicit system notification authorization and Rust's
version-fenced firing plans. The app schedules the nearest 64 entries in a
rolling 30-day window, checks that the system retained them, and reports pending
entries beyond that device budget. Invalid or changed plans preserve the current
OS schedule. Opening a notification retains its owning vault and queues its
task route while an existing editor remains open; credentials never enter the
notification payload.

## Running locally

```bash
bun install --frozen-lockfile       # once, from the repo root
cd packages/tasks-for-obsidian     # the scripts below are this package's
bun run ios:native:generate         # root mise XcodeGen pin
# Build native Rust slices first, from packages/tasknotes-core:
# cargo xtask build-xcframework --platform macos --platform ios --platform ios-sim
# Open ios/TasksForObsidian.xcodeproj and run its native scheme.
# bun run ios opens that generated project; bun run android builds tasknotes-android.
```

Run the simulator app through Xcode with its configured App Group entitlements,
or use the normal ad hoc simulator producer from this package:

```bash
xcodebuild -project ios/TasksForObsidian.xcodeproj \
  -scheme TasksForObsidian -configuration Debug \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' \
  -derivedDataPath .build/ios-native \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

Unsigned builds (`CODE_SIGNING_ALLOWED=NO`) prove compilation and isolated view
rendering only. Running the standalone engine also requires the simulator's
normal signing and entitlement processing for App Groups and Keychain.

The existing Debug launch argument `--facet-native-acceptance` opens the app's
`Documents/Native acceptance` vault. It does not generate sample tasks or their
configuration. Seed real Markdown notes and a canonical `tasknotes.yaml` there
before launching; configure title storage and task detection to match the notes.
For example, frontmatter titles with `tags: [task]` use:

```yaml
title:
  storage: frontmatter
task_detection:
  method: tag
  tag: task
```

## Testing

### Live Apple Sync acceptance

`bun run apple:sync:live prepare` builds the current Debug iOS app on a new
disposable simulator and the separate `TaskNotesAcceptance` macOS app. It creates
a synthetic reference seed for the encrypted Sync vault under
`.build/live-sync/<runID>/reference-vault`
and records source, app, fixture and attachment hashes. The live seed omits
`tasknotes.yaml` so portable configuration cannot mask official plugin settings.
It uses complete status definitions pinned to official TaskNotes 4.13.8; partial
status entries from the immutable mapping corpus are not valid plugin settings.
Existing app identities, vaults and simulators are outside this runner's ownership.

For Mac acceptance without an iOS simulator, use
`bun run apple:sync:live prepare --clients macos`. This builds only the Mac
acceptance app, performs no iOS generation or simulator operations, and records a
schema-version-2 manifest/provenance with `scope: "macos"`. Only the Mac artifact
is fingerprinted. The default command retains schema-version-1 dual-client
behavior, and existing runs keep their original requirements. Mac-only results
prove two replicas (official Obsidian and Facet Mac); they do not establish iOS or
three-client acceptance. Every case and all three consecutive rounds are still
required for the selected scope. Commands naming an unselected client fail.
For native UI execution, set `TASKNOTES_UITEST_IDENTITY` to the SHA-1 identity
from the existing login Keychain when preparing. It signs only the Mac UI-test
runner; the app and dependencies retain their project signing settings. The
value must be 40 hexadecimal characters. Omitting it preserves ad-hoc signing.

Open the printed reference folder in official Obsidian, install and enable
TaskNotes **4.13.8**, and connect only the designated synthetic encrypted remote
vault. Preserve existing remote vaults; provision a new one only when explicitly
authorized. Enable all other attachment types and vault configuration/plugin
data in Sync, including **Installed community plugins** (which also synchronizes
plugin settings), restart Obsidian, and wait for synchronization. Store the separate
vault password in 1Password. Account entry and MFA are manual, with recording off.
Mac-only runs may use the reviewed [`mac:account` driver](../tasknotes-macos/README.md#isolated-native-acceptance)
for normal account controls and existing-profile lifecycle reauthorization through
1Password. Recording stays off; driver receipts do not establish live acceptance.

```bash
bun run apple:sync:live seal-reference <runID>
bun run apple:sync:live discover <runID>
# Sign in manually; identify only the exact synthetic vault. Discovery cannot authorize a vault.
bun run apple:sync:live bind-vault <runID> <nonsecret-remote-vault-id>
bun run apple:sync:live resume <runID>
# Authenticate both isolated apps and connect only the bound synthetic vault.
bun run apple:sync:live verify <runID>
bun run apple:sync:live reference-changes <runID>
bun run apple:sync:live journeys <runID>
bun run apple:sync:live offline <runID>
bun run apple:sync:live conflicts <runID>
bun run apple:sync:live lifecycle-begin <runID> ios
# Manually sign in and reconnect the existing profile, with recording off.
bun run apple:sync:live lifecycle-finish <runID> ios
# Repeat lifecycle-begin / lifecycle-finish for macos.
# In a Mac-only run, run lifecycle-begin / lifecycle-finish only for macos.
bun run apple:sync:live authentication-fixtures <runID>
bun run apple:sync:live official-ui-instructions <runID>
# Follow the four owner UI actions and run official-ui <runID> <step> after each.
bun run apple:sync:live complete-round <runID>
bun run apple:sync:live status <runID>
```

Sealing checks the installed plugin version, enabled state, normalized supported
settings and unchanged seed notes/attachments. Initial verification requires
fresh status from every selected real client, matching remote vault identity, drained
durable queues, no conflicts or pending host work, and identical synthetic file
paths and hashes in every selected replica plus official Obsidian. Each selected native app must execute the
initial configuration UI test, display the current reference task exactly once,
and enable capture without configuration warnings or a defaults prompt. The
runner rechecks convergence after those cold launches before recording a pass.
Initial download has a 180-second deadline;
later convergence has 120 seconds. Failures retain the run without automatic retries.

Sealing and every completed round verify the exact official plugin manifest,
JavaScript and stylesheet hashes against the pinned release. Native configuration
captures require successful reference changes and matching settings evidence from
the current round. Before offline recovery resumes transport, it verifies the
bound disconnected profile, persisted edited task bytes, and a nonempty durable
outbox whose operation digest and count remain unchanged during the check.

Reference changes exercise file writes through official Obsidian's Sync transport;
they do not constitute official TaskNotes UI interaction. Native journeys capture,
edit, complete, uncomplete and cold-relaunch on both clients in the active round.
They also check that a changed plugin default produces high-priority native tasks.
Offline journeys retain local edits across relaunch and verify convergence after
reconnection. Authentication fixture evidence is distinct from live account/MFA
acceptance. Conflict journeys preview both divergent versions, keep both and
verify their exact bytes across all replicas. Session journeys preserve the
original profile and pending uploads through sign-out, cold launch and manual
reauthorization. Official TaskNotes UI actions remain owner-attested. For each
create, edit, complete and uncomplete action, save a real PNG screenshot beneath
`.build/live-sync/<runID>/official-ui/round-<round>/<step>.png`, showing only the
synthetic vault and task. Create this private directory before saving the first
image. Missing images leave that checkpoint pending; account entry, credentials,
and unrelated vaults must stay outside captures. The runner validates bounded PNG
integrity, records the exact image hash, and verifies task state and declared-replica
file convergence. A reviewer must inspect every retained image before claiming
visual acceptance; image hashes alone do not establish what was shown.

`complete-round` requires every scenario, unchanged source/artifacts and final
convergence. It archives evidence before advancing to the next unique round
namespace. Repeat the complete matrix for rounds two and three; only then may
the three-consecutive-runs case pass. Stage failures persist and block replay
in that run. Fix the cause and prepare a new owned run; retained failure evidence
is never replaced by a passing retry. Manual reauthentication checkpoints remain
pending until their measured follow-up succeeds.

Post-authentication XCTest evidence is retained under each run's `journeys` folder.
Mac journeys retain custom captures of explicitly owned workspace windows and
discard automatic system desktop attachments. Inspect those app-only images
before using them as visual proof or publishing them.
Raw result bundles and account diagnostics stay private; publish only selected
synthetic screenshots/recordings and bounded provenance. `cleanup <runID>` removes
only the exactly owned simulator after every required case passes. It never deletes
the remote vault, macOS state or failed-run evidence.
Mac-only cleanup marks the completed run cleaned and retains all app data and
evidence; there is no simulator to delete.

```bash
bun run check:ios-native-deps       # shared bootstrap and product contract
bun run lint:swift                 # preserved extensions and the native app
bun run format:swift:check         # native Swift layout from the shared Apple policy
bun run ios:native:e2e             # disposable simulator, real local vault and XCUITest
# Apple host/schema tests: tasknotes-macos/Tests/TaskNotesKitTests.
```

`ios:native:e2e` requires the matching macOS and iOS simulator Rust slices and
the pinned Xcode/XcodeGen tools already installed. After a Rust toolchain update,
install its `aarch64-apple-ios-sim` and `x86_64-apple-ios` targets with `rustup target add`.
Provision the localized native tools with
`ios/ci_scripts/mise-native.sh install --yes bun rust aqua:yonaskolb/XcodeGen`;
the launcher disables implicit installation of unrelated tools.
It creates and seeds a fresh
iPhone simulator from `tasknotes-fixtures/e2e/local-vault`, builds the normally
signed app/widget and drives capture, edit, completion and two application
relaunches. A second journey checks capture and draft discard at accessibility
text size. The runner refuses to launch outside the simulator identified by the
harness. The launcher verifies the final title, completion metadata and exact
preservation of the original task, reference note and configuration. It deletes
only its newly created simulator, retaining the synthetic vault, xcresult bundle,
screenshots, XCTest screen recordings and source/build fingerprints in `.build/native-e2e/<run-id>/`.
Existing simulators and their accounts are not used. This suite exercises local
vault operations; live Sync, account onboarding, reminders, interruption/recovery
and other platforms require their own acceptance evidence.

Shared schema positive, negative,
and raw numeric fixtures run at both Apple and Android boundaries. Retain
matched XCFramework/source fingerprints and xcresult/rendered artifacts.
Legacy `src`, `contract-tests`, and Maestro scenarios verify the former client;
passing them alone does not prove the standalone product.

## Release builds

Archive/TestFlight builds use Xcode Cloud. Its post-clone hook bootstraps the
pinned root `bin/mise`, installs the root Bun/Rust/XcodeGen tools, performs a
frozen workspace install, builds native Rust slices, and generates the native
Xcode project and locked third-party notices. CocoaPods and Metro are not
release prerequisites.

`bun run ios:native:archive -- --dry-run` creates an unsigned archive for local
inspection. Signed export requires reviewed export options, the owner's team
and provisioning profiles, current Apple agreements, and the owner's encryption
determination. The command does not upload or publish a build.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
