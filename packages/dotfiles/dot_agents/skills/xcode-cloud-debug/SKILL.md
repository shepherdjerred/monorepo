---
name: xcode-cloud-debug
description: |
  Pull Xcode Cloud build logs and debug iOS Archive/TestFlight failures for the
  Tasks for Obsidian app (packages/tasks-for-obsidian). Use when an Xcode Cloud
  build fails, when the user forwards a "Command PhaseScriptExecution failed with
  a nonzero exit code" email, when an Archive - iOS action is red, when a
  TestFlight upload didn't happen, or when you need the raw xcodebuild/Metro logs
  from a cloud build that you cannot see locally. Covers pulling logs via the App
  Store Connect API, reading the log bundle, reproducing the release bundle
  locally, and the known "@tasknotes/model" Metro resolution failure.
---

# Xcode Cloud Debug (Tasks for Obsidian)

iOS release builds run on **Apple's Xcode Cloud** — the monorepo has no CI of its
own (the Dagger/Buildkite pipeline was removed 2026-07). When a build
fails you only get a terse email; the real error lives in the cloud build log.
This skill pulls those logs and debugs the common failures.

## 1. Pull the logs

A committed script fetches build logs via the App Store Connect API. Credentials
come from **1Password** — nothing secret is on disk in the repo.

```bash
cd packages/tasks-for-obsidian

# List the last 20 build runs (newest first): number, status, date, id
bun scripts/xcode-cloud-logs.ts runs

# Download every action's logs for the newest FAILED run
bun scripts/xcode-cloud-logs.ts logs latest-failed

# ...or a specific build run id, with an optional output dir
bun scripts/xcode-cloud-logs.ts logs <buildRunId> ./out
```

Default output: `packages/tasks-for-obsidian/xcode-cloud-logs/<buildRunId>/`
(gitignored). Each action yields a `LOG_BUNDLE` zip (the xcodebuild logs) and a
`RESULT_BUNDLE` xcresult zip.

### Credentials (1Password)

- Item: **"App Store Connect API — Xcode Cloud"** in the **Personal** vault.
- Fields: `credential` (the `.p8` private key, ES256), `key id`, `issuer id`.
- The em-dash in the title breaks `op read` secret references, so the script
  uses `op item get "<title>" --vault Personal --fields ...` instead. If you ever
  reference it by `op read`, use the item **id**, not the title.
- The key is an App Store Connect **Team Key** (Users and Access → Integrations).
  If it's ever revoked, mint a new one, download the `.p8` **once**, and update
  the three 1Password fields.

## 2. Read the log bundle

```bash
cd packages/tasks-for-obsidian/xcode-cloud-logs/<buildRunId>
unzip -o *LOG_BUNDLE*.zip -d log
# The archive log is the big one:
grep -nE 'error:|Command PhaseScriptExecution failed|\*\* ARCHIVE FAILED|The following build commands failed' \
  "log/"*"/xcodebuild-archive.log"
```

`Command PhaseScriptExecution failed with a nonzero exit code` means a **Run
Script build phase** failed. Scroll up from that line to the phase name and its
stderr — that's the real error. The main phases for this app:

- **"Bundle React Native code and images"** — runs Metro to build the JS bundle
  (only in Release/Archive, not simulator debug). Most common failure point.
- `[CP] Check Pods Manifest.lock` — `Podfile.lock` out of sync with `pod install`.
- `[CP-User] [Hermes] …` / `ReactCodegen` — RN native codegen.

`ci_post_clone.log` covers the dependency bootstrap (`ios/ci_scripts/ci_post_clone.sh`).

## 3. Known failure: Metro can't resolve `@tasknotes/model`

**Symptom** (in the bundle phase):

```
UnableToResolveError: Unable to resolve module @tasknotes/model
  from packages/tasknotes-types/src/v2.ts
```

**Cause:** `tasks-for-obsidian` depends on `tasknotes-types` via `file:` and
consumes it **from source** (`tasknotes-types` `main`/`exports` point at
`src/*.ts`). The Release bundle follows `tasknotes-types/src/v2.ts`, which
re-exports `@tasknotes/model` — a dependency declared by **tasknotes-types**, not
by the app. Bun does **not** install a `file:` directory dependency's own
transitive deps into the consumer, so Metro resolves `@tasknotes/model` from
`packages/tasknotes-types/node_modules`. If that directory isn't installed on the
worker, bundling fails.

**Fix:** `ios/ci_scripts/ci_post_clone.sh` must run `bun install` in
`packages/tasknotes-types` (not just in the app) so its `node_modules` is
populated. This generalizes: **any source-only `file:` dep the bundle imports
needs its own `bun install` on the worker.** Also keep the app's `bun.lock`
regenerated whenever a consumed workspace package gains a new dependency.

**Guard (catches this class pre-merge):** `bun run check:release-bundle`
(`scripts/check-release-bundle.ts`) runs the exact Release Metro bundle — the
same one Xcode Cloud runs during Archive, but pure JS so it runs anywhere.
It used to be wired into a CI step, but the pipeline was removed 2026-07 — **run
it locally before merging** anything that touches the app's deps or imports. Any
unresolvable import (from any package) fails the guard before it reaches Xcode
Cloud. If you add a new source-only `file:` dep, install it in
`ci_post_clone.sh` — the guard will go red until you do.

## 4. Reproduce the Archive JS bundle locally

You don't need Xcode Cloud to reproduce a bundle-phase failure — run the exact
Release Metro command locally (a simulator `bun run ios` skips it):

```bash
cd packages/tasks-for-obsidian
node node_modules/react-native/scripts/bundle.js bundle \
  --entry-file index.js --platform ios --dev false --reset-cache \
  --bundle-output /tmp/main.jsbundle --assets-dest /tmp/assets --minify false
```

Success writes a multi-MB `/tmp/main.jsbundle`. A resolution error reproduces the
CI failure. To simulate the worker's dependency state, wipe and reinstall exactly
what `ci_post_clone.sh` installs (app + tasknotes-types), then re-run.

## 5. Extending the puller

`scripts/xcode-cloud-logs.ts` mints a short-lived **ES256 JWT** (App Store
Connect requires the raw R||S / IEEE-P1363 signature, not DER; `aud` is
`appstoreconnect-v1`) and walks the API:

- `GET /v1/ciProducts` → find the product (TasksForObsidian id is a constant in
  the script).
- `GET /v1/ciProducts/{id}/buildRuns?sort=-number` → recent runs.
- `GET /v1/ciBuildRuns/{id}/actions` → per-action status.
- `GET /v1/ciBuildActions/{id}/artifacts` → each artifact has a `downloadUrl`.

Docs: <https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds>

## Related

- `packages/tasks-for-obsidian/AGENTS.md` — Xcode Cloud + troubleshooting section.
- `op-helper` skill — 1Password CLI patterns (batch calls; each is biometric-gated).
