# tasks-for-obsidian

**Facet**, the standalone iOS SwiftUI app, shares the Rust engine and Apple host
with [`tasknotes-macos`](../tasknotes-macos). It opens a supported local vault
folder as an independent private copy or creates an app-private replica of an
existing Obsidian Sync vault. Importing preserves the original folder and does
not synchronize later edits with it; interrupted imports can be retried.
No TaskNotes server is required. `tasks-for-obsidian` remains the workspace name.

First-party code is GPL-3.0-only. The native bundle contains the exact repository
[license text](../../LICENSE) and separate notices for its locked dependencies.

The mobile interface keeps the Inbox, Today, Upcoming and Browse tabs. Today
includes overdue work; Upcoming retains future tasks beyond the visible week.
Search opens a separate vault-wide task list. Lists offer configuration-aware
filters, sorting and task selection, and saved views have their own editable
queries, names, symbols, colors and favorites.

Quick Add from Today, a selected Upcoming day or a project carries that context
and its owning vault into the capture sheet. Rust combines the context with
recognized input; explicit chip removals and form edits remain authoritative.
Submission freezes the vault, context, clock and action identity, so a retry does
not redirect the capture or reinterpret its date. Row scheduling offers native
calendar selection and Today, Tomorrow, This weekend and Next week shortcuts;
the shortcuts resolve through Rust against one viewer day. The native calendar
does not display the former calendar's task-density markers.

Settings offers System, Light and Dark appearance for iOS. This device-local
choice persists across launches; invalid stored choices require an explicit
replacement. It does not migrate the former React Native app's AsyncStorage
preferences. Time tracking, Pomodoro and duration estimates are not supported.

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

Automated live acceptance requires an already provisioned, running headless Tart
guest. Prepare with explicit guest and immutable official-app export identities:

```bash
bun run apple:sync:live prepare --vm <running-VM> \
  --official-export <export-UUID> --official-sha256 <archive-SHA256>
# Add --clients macos to omit iOS while retaining the complete two-replica matrix.
```

Preparation builds the current Debug iOS app on an owned disposable simulator
when selected and exports the separately signed Mac acceptance app. Its schema-3
manifest binds the guest, run, source, signed artifacts, immutable configuration
and executable bundle. The official Obsidian vault and Mac replica exist inside
the guest. The host's `.build/live-sync/<runID>/reference-vault` is only an
immutable seed; it is never counted as a syncing replica. Status, complete file
inventories, exact bytes, outbox fingerprints and reference mutations cross a
closed, freshness-checked Guest Agent protocol. Failed guest operations never
fall back to the host desktop. This command does not download or boot a VM,
copy user account data, or grant privacy permissions.

The live seed omits
`tasknotes.yaml` so portable configuration cannot mask official plugin settings.
It uses complete status definitions pinned to official TaskNotes 4.13.8; partial
status entries from the immutable mapping corpus are not valid plugin settings.
Existing app identities, vaults and simulators are outside this runner's ownership.

For Mac acceptance without an iOS simulator, use
`bun run apple:sync:live prepare --clients macos --host-ui`. This explicit manual path builds only the Mac
acceptance app, performs no iOS generation or simulator operations, and records a
schema-version-2 manifest/provenance with `scope: "macos"`. Only the Mac artifact
is fingerprinted. The manual dual-client command is `prepare --host-ui`; it
retains schema-version-1 behavior. Existing schema-1/2 runs require `--host-ui` on
every subsequent command. Omitting both execution choices fails before
preparation; a guest manifest cannot be reopened in host UI mode. Mac-only results
prove two replicas (official Obsidian and Facet Mac); they do not establish iOS or
three-client acceptance. Every case and all three consecutive rounds are still
required for the selected scope. Commands naming an unselected client fail.
For native UI execution, set `TASKNOTES_UITEST_IDENTITY` to the SHA-1 identity
from the existing login Keychain when preparing. It signs only the Mac UI-test
runner; the app and dependencies retain their project signing settings. The
value must be 40 hexadecimal characters. Omitting it preserves ad-hoc signing.

Mac relaunch inspects the exact acceptance executable's text mapping and requires
a single candidate. A separate libproc helper verifies its primary executable,
UID/RUID and BSD start time immediately before submitting TERM. Those adjacent
checks and signaling are separate operations; the harness then observes process
exit before launching again. Ambiguous owners, unexpected diagnostics and expired
parent deadlines fail closed. Local helper controls use only a newly spawned
harmless child:

```bash
bun scripts/apple-sync-live/mac-process-owner.native-controls.ts
```

For guest execution, the owner-setup entry launches only the exact exported
official app and owned reference, installs the separately exported pinned plugin,
and presents normal account controls:

```bash
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> launch
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> plugin --plugin-export <UUID>
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> present
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> probe
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> credentials \
  --credential-backend keychain \
  --account <1Password-account-ID> --vault <vault-ID> --item <item-ID>
# Only when the official app requests an authenticator verification code:
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> verification-probe
bun scripts/apple-sync-live/transport/execution/official-host.ts <runID> verification \
  --credential-backend keychain \
  --account <1Password-account-ID> --vault <vault-ID> --item <item-ID>
```

Account and verification-code reads default to a local, nonsynchronizing macOS
Keychain item. Install the dedicated signed helper and explicitly enroll the
designated login once before live acceptance:

```bash
bun ../tasknotes-macos/scripts/local-credentials.ts install \
  --identity <pinned-40-hex-certificate-SHA1> --team <pinned-team-ID>
bun ../tasknotes-macos/scripts/local-credentials.ts enroll \
  --account <1Password-account-ID> --vault <vault-ID> --item <item-ID>
```

Installation requires the explicit existing Apple Development identity and team
from the helper's pinned signing profile; other identities fail before setup.
The helper remains at
`~/Library/Application Support/FacetAcceptanceCredentials/bin/facet-credentials`;
only that signed helper is trusted to read its credential item. Enrollment reads
the designated 1Password item through the normal Desktop authorization flow and
passes selected login credentials and any OTP seed through private memory-only
input into the local classic Keychain. The original 1Password item stays unchanged.
Enrollment does not copy the login into the Homelab vault or grant a service
account access to the Personal vault. Enrollment refuses an existing local record
and preserves its bytes and access policy. It checks that the local target is
missing and usable before requesting source approval, then verifies a fresh helper
read after insertion before reporting successful enrollment.

Routine reads disable Keychain authentication UI and stop if the item is missing,
locked or denied. They never fall back to 1Password, open an approval prompt or
change the item's access policy. Keep the helper's signing identity stable;
installation does not automatically broaden an existing item's trust. An explicit
`--credential-backend desktop` selects attended account/verification reads, while
`--credential-backend service-account` requires separately provisioned machine
access. `--account`, `--vault` and `--item` remain required, and local records bind
all three original locators. Service-account reads use their token's account and
omit the `op --account` selector.

The separate vault encryption password keeps its existing `service-account`
default through `scripts/onepassword/with-service-account.sh`; local login
enrollment does not copy it. `--vault-password-backend desktop` selects an
explicit attended read instead. Every backend failure stops before the requested
value is sent to the app, without trying another backend. These choices configure
test setup only; installed apps use their normal sign-in UI and Keychain.

The probe uses synthetic values and zero submits; real entry requires its measured
privacy proof and performs one normal submit. Account success, conditional MFA,
and selection of the designated remote vault require observed follow-up; a submit
receipt alone proves none of them. No unknown submission is repeated automatically.

Official authenticator verification has its own form-bound probe and exclusive
submission record. `verification-probe` fills and clears a public six-digit value
without submitting. The host retains the unredacted fake stdout/stderr and
publishes approval only after full channel/exit validation and sentinel checks.
Real verification requires both the native phase proof and this source-bound host
approval; real codes and code-frame hashes never enter artifacts. The real
`verification` operation accepts only the local Keychain backend and requires the
enrolled OTP seed. It prepares and validates
the native helper, exact authenticator form, process lifetime and empty-field
focus before generating a code. The pinned official app bytes bind the helper's
input-behavior assumptions and exact authenticator label. No-code preparation
retains bounded stdout/stderr, exit status and fixed guard-phase diagnostics
before enforcing its result; malformed or oversized output remains a failure.
The real OTP session stream is never captured. After final source/artifact checks, the code
crosses the already prepared private channel for normal entry and submission.
Validity is checked before typing and clicking; a separate durable intent is
written before real code entry. An unknown outcome remains retained without
automatic regeneration or resubmission. Email or recovery-code challenges do not
use this authenticator path. Source changes require fresh artifacts and probes;
an earlier password or verification proof cannot authorize changed input code.

Manual host execution requires opening the owned reference and installing
TaskNotes **4.13.8** explicitly. Both modes must connect only the designated
synthetic encrypted remote vault. Preserve existing remote vaults; provision a new
one only when explicitly authorized. Enable all other attachment types and vault
configuration/plugin data in Sync, including **Installed community plugins**
(which also synchronizes plugin settings), restart Obsidian, and verify synchronization.
Store the separate vault password in 1Password. Account captures stay off.
Use the [`mac:account` driver](../tasknotes-macos/README.md#isolated-native-acceptance)
for normal account controls and existing-profile lifecycle reauthorization through
the selected credential backend. Recording stays off; driver receipts do not
establish live acceptance.

The iOS driver separates control from field values. The prepared run's exact
signed UI Runner receives only nonsecret control frames through its owned
simulator socket. Field values travel from the host through a private native
socket bridge into the mounted account form's existing state. This input adapter
exists only in Debug simulator builds with a valid acceptance descriptor. It
binds the session and form instance, verifies kernel peer identity, and closes
when the app leaves the foreground or the form is dismissed. Normal button taps
still perform authentication and vault connection through the existing app code. The Runner establishes secure
keyboard focus while fields are empty and observes the real disabled/enabled
button checkpoints without receiving credential values.

For an admitted private session on that owned form, the Debug simulator adapter
exposes fixed Empty/Entered accessibility values for the email and verification
fields. Their rendered text, state, roles, identifiers and normal controls stay
intact. This confinement remains latched while injected state exists, including
after peer teardown. The host verifies clean private-helper shutdown before
ending the native session or requesting normal Connect; unexpected closure blocks
that action without clearing the vault password before Connect.

The input path never uses the clipboard, credential arguments, environment values
or credential files. First run the synthetic-only privacy probe against the exact
prepared artifacts:

```bash
bun run ios:account <runID> probe
```

The probe compiles the native bridge and canonical process-owner helper once
under the run's `ios-account/native` directory. It pins their bytes along with the
app, Runner and source inventory. Real credential entry reuses those verified
helpers without rebuilding or repairing them; missing or changed inputs stop.
The command runs two sequential synthetic phases against the same prepared
app, Runner and helpers. The email/password phase makes zero submit actions.
The verification phase uses a named Debug simulator HTTP fixture bound to the
validated descriptor and initialized account instance. It permits one normal
initial Sign in, then the normal Rust response decoder opens the MFA form from
the fixture's fixed challenge response. The fixture accepts only the expected
synthetic request sequence, has its own account directory and a nonpersistent
credential boundary, and cannot reach the real backend or fall back to network
traffic. It enters a synthetic six-digit code without submitting it or connecting
a vault. This proves fixture UI/privacy behavior, not Obsidian authentication.

Both phases scan stdout, stderr, decoded XCTest activities, every SDK-declared
log, exported diagnostics, raw result files and attachments. The verification
phase also scans the exact six-digit sentinel across all raw bytes and supported
encodings; no diagnostic file is excluded. The proof retains
the SDK's content-availability record and distinguishes decoded console output
from confirmed absence; missing or unreadable declared content fails closed.
Any sentinel leakage, unexpected visual artifact,
failed native assertion or incomplete evidence blocks real credential reads.
Results are retained without redaction. A successful proof is bound to the run,
full source inventory, exact app/Runner/helper bytes and immutable retained
evidence. Closed stage observations and independent cleanup results exclude raw
value frames. A source change requires fresh preparation and a new passing probe;
an earlier run's proof cannot authorize changed input code.
Both distinct phase proofs must match the exact app, Runner, helpers and source
inventory before any real credential read. A single earlier phase proof cannot
authorize the automatic workflow.

Only after that proof may the operator invoke:

```bash
bun run ios:account <runID> credentials \
  --credential-backend keychain \
  --account <1Password-account-ID> --vault <vault-ID> --item <item-ID> \
  --vault-password-ref <op-reference> --vault-password-backend service-account
# Reauthorization adds --lifecycle-round <1|2|3> and uses the original profile.
```

The host reads the selected credential backend only after the owned form is ready,
rechecks ownership after the read, and sends values through private memory-only
input. Credential entry, optional verification, and connection each have separate
submit actions; only the descriptor-bound remote vault and retained reconnect
profile are allowed. Automatic authenticator entry uses only the enrolled local
Keychain seed. The host reads it once, runs its expensive source/artifact/owner
checks, waits for an eligible validity counter and rechecks live app/helper/Runner
ownership, then issues one code immediately before private delivery. App and Runner
clocks must agree; expiry is checked in the same MainActor turn as field mutation
and immediately before the normal verification tap. A short or expired window
stops without code regeneration or resubmission.
The session stays alive until actual UI and control status settle. A successful
finish relaunches the same owned app to resume Sync; replica convergence remains
the matrix's responsibility. Unknown submission outcomes retain inspectable
state and stop without automatic resubmission.

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
reauthorization. In guest mode, official TaskNotes UI actions are followed by
measured app-only captures through the guest endpoint. In manual host mode, those
actions remain owner-attested: for each create, edit, complete and uncomplete action,
save a real PNG screenshot beneath
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

`bun scripts/occurrence-acceptance/run-ios.ts` creates a separate disposable
simulator for the recurrence journey. Three ordered XCTest selectors drive the
production Generate and Repair buttons, preserve a completed child when its
future occurrence cannot find its template, verify exact parent/child bytes
after repair Undo, and verify a second repair across cold relaunch. The harness
restores only its synthetic template between stopped-app stages. It retains
each selector's exact result, app-only screenshots, source fingerprints and
Markdown in `.build/native-e2e/<run-id>/`. The ordinary two-case journey and its
three-Markdown-file gate remain unchanged and required separately.
Both local runners retain file-backed command logs and enforce deadlines on
actual command exit, including XCTest startup and simulator cleanup. Output
descriptors inherited by another process cannot extend the command's lifetime.

`bun scripts/ios-parity-acceptance.ts` runs a separate three-stage mobile journey
on one newly created simulator. It checks Today sections, tasks fourteen days
ahead, vault-wide metadata search, contextual capture and quick scheduling across
cold launches, touch selection, filters, sorting and saved-view editing. Its
synthetic vault uses the actual viewer day and timezone; a change during the run
fails acceptance. Each stage retains app-only screenshots and verifies the
persisted Markdown, configuration, reference and attachment bytes. The existing
two-case local journey and its original preservation gate remain separate and
required. These local journeys do not establish live Sync or physical-device
audio and haptic acceptance.

`bun scripts/board-acceptance/run-ios.ts` uses a separate owned simulator and a
120-task vault with two active workflow columns. Its two bounded tests scroll to
a lower loaded card, open and cancel the actual editor, then use the board's
native Load More control to reach a card beyond the initial 100 tasks. Each
stage verifies every synthetic task, saved view, configuration, reference and
attachment byte remains unchanged and retains paired app/simulator screenshots.
This board journey is separate from the existing local and mobile parity gates.

Shared schema positive, negative,
and raw numeric fixtures run at both Apple and Android boundaries. Retain
matched XCFramework/source fingerprints and xcresult/rendered artifacts.
Legacy `src`, `contract-tests`, and Maestro scenarios verify the former client;
passing them alone does not prove the standalone product.

## Release builds

Archive/TestFlight builds use Xcode Cloud; Woodpecker owns repository verification.
The post-clone hook bootstraps the
pinned root `bin/mise`, installs the root Bun/Rust/XcodeGen tools, performs a
frozen workspace install, builds native Rust slices, and generates the native
Xcode project and locked third-party notices. CocoaPods and Metro are not
release prerequisites.

`bun run ios:native:archive -- --dry-run` creates an unsigned archive for local
inspection. Signed export requires reviewed export options, the owner's team
and provisioning profiles, current Apple agreements, and the owner's encryption
determination. The command does not upload or publish a build.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
