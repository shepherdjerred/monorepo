# tasks-for-obsidian

**Facet**, the iOS app: React Native (bare workflow, no Expo), for tasks synced
with the TaskNotes Obsidian plugin via its HTTP API — the mobile client to
[`tasknotes-server`](../tasknotes-server). Shipped through TestFlight as Facet;
`tasks-for-obsidian` stays the internal package name, and TaskNotes remains the
server/API terminology.

Features: quick capture, task detail, saved views, kanban board, bulk task
organization, and offline cues backed by a sync queue. Uses Metro, Hermes, and
the New Architecture; iOS native code (app + widget) lives in `ios/`.

## Running locally

```bash
bun install                        # from the repo root
cd packages/tasks-for-obsidian     # the scripts below are this package's
bun run pod-install    # iOS native deps (CocoaPods)
bun run ios            # build + launch on simulator
bun run start          # Metro bundler (separate terminal)
```

## Testing

```bash
bun run test           # unit tests (src, scripts, deterministic e2e date tests)
bun run test:contract  # wire-contract suite against a real spawned tasknotes-server
bun run e2e            # Maestro e2e: simulator + local server + chaos proxy (local-only)
bun run typecheck      # tsc --noEmit
bun run lint           # ESLint
bun run lint:swift     # SwiftLint on the iOS native code
```

The contract suite lives in `contract-tests/` and runs in CI; the Maestro e2e
suite (`e2e/`) needs a simulator and stays a local pre-merge gate.

## Release builds

Archive/TestFlight builds run on Xcode Cloud, not Buildkite.
`bun run check:release-bundle` reproduces the release bundle locally when a
cloud build fails.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
