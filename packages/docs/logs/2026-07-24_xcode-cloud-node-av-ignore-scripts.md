---
id: log-2026-07-24-xcode-cloud-node-av-ignore-scripts
type: log
status: complete
board: false
---

# Xcode Cloud build #61 failure — node-av native install script

## Symptom

Tasks for Obsidian iOS release build **#61** (2026-07-24, run
`cf452190-76a9-49a9-a144-22259ff9844e`) failed. Only artifact returned was
`ci_post_clone.log` — the build died in the **dependency bootstrap**, before the
Archive/Metro phase ran.

## Root cause

`ci_post_clone.sh` runs `bun install --frozen-lockfile --linker hoisted` inside
`packages/tasknotes-types` (and again in the app). In this monorepo, `bun install`
from any workspace member resolves the **entire root workspace**, so it runs the
native install scripts of every package in root `package.json`
`trustedDependencies`:

```
@lng2004/node-datachannel, @sentry/profiling-node, @snazzah/davey,
node-av, node-datachannel, sharp, unrs-resolver
```

`node-av` (^5.2.2, a dep of `packages/discord-video-stream`) needs a prebuilt
binary or a system FFmpeg. The Xcode Cloud worker has neither:

```
node-av: ⚠️  No prebuilt binary and no system FFmpeg found
error: install script from "node-av" exited with 1
```

That aborts the whole `bun install`, failing the post-clone step. This is a
**new** failure mode, unrelated to the previously documented `@tasknotes/model`
Metro-resolution issue.

## Fix

Add `--ignore-scripts` to both bootstrap installs in
`packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh`. None of the trusted
native Node addons are needed on the iOS worker — the app's native code comes from
CocoaPods (`pod install`) and Metro only needs JS resolution + a hoisted
`node_modules` tree. Skipping lifecycle scripts doesn't affect either.

## Verification

- `bun run scripts/check-release-bundle.ts` (the exact Release Metro bundle Xcode
  Cloud runs during Archive) — confirms `@tasknotes/model` and all imports still
  resolve after the change.
- shellcheck (via `bun run verify`) on the edited script.
