# tasks-for-obsidian

**Facet**, the standalone iOS SwiftUI app, shares the Rust engine and Apple host
with [`tasknotes-macos`](../tasknotes-macos). It opens a supported local vault
folder as an independent private copy or creates an app-private replica of an
existing Obsidian Sync vault. Importing preserves the original folder and does
not synchronize later edits with it; interrupted imports can be retried.
No TaskNotes server is required. `tasks-for-obsidian` remains the workspace name.

First-party code is GPL-3.0-only. The native bundle contains the exact repository
[license text](../../LICENSE) and separate notices for its locked dependencies.

The registered app identity, App Group, widget extension, App Intents, and Live
Activity declarations are preserved. Vault credentials live in Keychain;
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

## Testing

```bash
bun run check:ios-native-deps       # shared bootstrap and product contract
bun run lint:swift                 # preserved extensions and the native app
bun run format:swift:check         # native Swift layout from the shared Apple policy
# Native interaction tests: ios/FacetUITests, TasksForObsidian scheme.
# Apple host/schema tests: tasknotes-macos/Tests/TaskNotesKitTests.
```

The native acceptance flow uses real Markdown capture/edit/relaunch and
inspects normal and accessibility text sizes. Shared schema positive, negative,
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
