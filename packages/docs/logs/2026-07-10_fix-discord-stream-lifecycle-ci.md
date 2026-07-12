# Fix discord-stream-lifecycle CI failure (discord.js unresolvable at runtime)

## Status

Complete

## Summary

`main` build #5211 went red on `Build + Smoke discord-plays-pokemon` and
`Build + Smoke discord-plays-mario-kart`, both failing with:

```
error: ENOENT while resolving package 'discord.js' from
'/workspace/packages/discord-stream-lifecycle/src/lifecycle/game-bot.ts'
```

Root cause: `discord-stream-lifecycle` is consumed as raw TypeScript source
by `discord-plays-pokemon`/`discord-plays-mario-kart`'s nested `packages/backend`
workspace (and by `streambot`). Under the hoisted linker, bun's wholesale copy
of that `file:` dependency into the consumer's `node_modules` does not fall
back to the consumer's ancestor `node_modules` for the copied subtree's own
runtime imports — so `discord.js` (a peer/dev dependency of
discord-stream-lifecycle, imported directly by `game-bot.ts`) was never
resolvable, even though it's correctly hoisted one level up.

## Fix

Give `discord-stream-lifecycle` a real build step and consume it as compiled
`dist/*.js`, matching the one proven pattern in this repo (`llm-models`,
consumed from the identical nesting depth) instead of raw source:

- `packages/discord-stream-lifecycle/package.json`: `main`/`types`/`exports`
  now resolve to `dist/`, `files: ["dist"]`, real `build` script
  (`tsc -p tsconfig.build.json`).
- `packages/discord-stream-lifecycle/tsconfig.build.json` (new): fully
  self-contained (no `extends` chain to the monorepo-root
  `tsconfig.base.json`, which isn't mounted in the isolated Dagger build
  container) — otherwise `skipLibCheck` silently doesn't apply and `tsc`
  chokes on unrelated type bugs inside `discord.js-selfbot-v13`'s own
  `.d.ts` files.
- `packages/discord-stream-lifecycle/bunfig.toml` (new): pins
  `linker = "hoisted"`, matching the existing pin in
  discord-plays-pokemon/mario-kart's own `bunfig.toml` (PR #1400) — this
  package never needed the pin before since it was never `bun install`ed as
  its own standalone project.
- 28 consumer files (discord-plays-pokemon, discord-plays-mario-kart,
  streambot, and discord-stream-lifecycle's own src/test) had their
  `@shepherdjerred/discord-stream-lifecycle/<subpath>.ts` imports stripped to
  `@shepherdjerred/discord-stream-lifecycle/<subpath>` (no extension), to
  match the new `dist/*.js` export targets.
- `.dagger/src/deps.ts`: added `discord-stream-lifecycle` to
  `BUILD_TIME_DEPS`.
- `.dagger/src/image.ts`: added `withBuiltDiscordStreamLifecycle` (mirrors
  `withBuiltLlmModels`) and wired it into `buildDiscordPlaysPokemonImageHelper`,
  `buildDiscordPlaysMarioKartImageHelper`, and the generic `buildImageHelper`
  (streambot's build path).
- `.dagger/src/base.ts`: added `withCleanReinstallIfNeeded` — see next section.

### The second bug: a corrupted first install

Switching to a compiled dist/ consumption fixed the module-resolution
mechanism, but exposed a SEPARATE, previously-latent bug: the FIRST
`bun install --frozen-lockfile` at a nested workspace root (e.g.
discord-plays-mario-kart) against a `file:` dep that itself has its own
populated `node_modules` (i.e. was pre-built via `withBuiltDiscordStreamLifecycle`
before this install runs) exits 0 but silently produces a corrupt copy — the
dep's own `package.json` lands as a broken self-referential symlink
(`package.json -> package.json`) inside the WORKSPACE MEMBER's `node_modules`
(`packages/backend/node_modules/@shepherdjerred/discord-stream-lifecycle/`,
since that's the member whose `package.json` declares the `file:` reference).
Any import from that dep then fails at runtime with `Cannot find module`,
even though `dist/*.js` genuinely exists at the correct path.

This reproduced deterministically (not a caching artifact — verified with a
freshly-named `BUN_CACHE` volume and a bumped dependency version) and is
distinct from the documented isolated-linker EEXIST race from PR #1400
(`linker = "hoisted"` was already correctly pinned). Since the install exits
0, `BUN_INSTALL_WITH_RETRY`'s failure-triggered retry never fires.

Fix: `withCleanReinstallIfNeeded` in `base.ts` runs the normal retry-wrapped
install, then — only when `discord-stream-lifecycle` is a dep — unconditionally
`find`s and removes every `node_modules` at the workspace root AND every
member directory, then installs again cleanly. This must be THREE SEPARATE
`withExec` layers (install, cleanup, reinstall) — combining them into one
shell script (`install && rm -rf node_modules && install`) reproduces the
same corruption. Root cause of why the split matters is unconfirmed; treated
as an empirically-verified Bun/Dagger snapshot-boundary quirk specific to
this scenario.

Wired into all three consumer build paths (pokemon, mario-kart, streambot)
plus the generic `bunBaseContainer` (used by lint/typecheck/test CI jobs).

## Verification

- `dagger call smoke-test-discord-plays-mario-kart` — pass
- `dagger call smoke-test-discord-plays-pokemon` — pass
- `dagger call smoke-test-streambot` — pass
- `bun test` in discord-stream-lifecycle — 56 pass, 0 fail
- `tsc --noEmit` clean for discord-stream-lifecycle and all three consumers
  (backend packages + streambot)
- `eslint` clean for discord-stream-lifecycle; pre-existing unrelated lint
  errors in discord-plays-pokemon/mario-kart confirmed present on `main`
  before this change (not introduced by it)

## Investigation dead ends (for future reference)

Several plausible-looking fixes were tried and failed before landing on the
above — recorded so a future debugging session doesn't re-tread them:

1. **Full `bun install` inside discord-stream-lifecycle's own directory
   before the consumer copies it** (mirroring `withForkRuntimeDeps` for
   discord-video-stream) — worked for mario-kart, broke pokemon with `Cannot
find module '@shepherdjerred/discord-stream-lifecycle/...'` (the WHOLE
   package, not just discord.js). Root cause at the time was misdiagnosed as
   an eslint-config `file:` symlink corrupting the wholesale copy.
2. **`--production` install for step 1** (to avoid installing devDependencies,
   theorized to dodge the corruption) — broke a DIFFERENT thing: silently
   dropped `debug`, an undeclared runtime dependency of `werift-rtp` (pulled
   transitively via `discord.js-selfbot-v13`) that in a full install only
   happens to be present because `eslint`'s own devDependency subtree also
   depends on `debug` — a phantom dependency, unrelated to `--production` vs
   full install.
3. **Symlink discord-stream-lifecycle's copied `node_modules` to the
   consumer's own `node_modules`** (no pre-install at all) — first attempt
   used the wrong path (workspace root instead of the workspace MEMBER's
   `node_modules`); second attempt (correct path) broke bun's own
   package-boundary detection for the whole copied subtree.
4. **Wildcard `exports` (`"./*"`) being the culprit** — disproved: bare `"."`
   import (the one export pattern proven to work elsewhere in this repo)
   failed identically when tested with a temporary real-entrypoint edit.
5. **Stale Dagger `BUN_CACHE` volume, or a stale lockfile snapshot** — both
   disproved empirically (fresh cache-volume name, bumped package version,
   regenerated consumer lockfiles — all no-ops, same failure).
6. **A single combined `rm -rf node_modules && bun install` shell script** —
   reproduced the corruption; only splitting cleanup and reinstall into
   separate Dagger `withExec` layers worked.
7. **Cleaning only the workspace ROOT's `node_modules`** before reinstalling —
   left the corrupted copy in the workspace MEMBER's `node_modules`
   untouched; had to `find` and remove `node_modules` at every level.

## Session Log — 2026-07-10

### Done

- Root-caused and fixed the CI failure on `main` build #5211
  (`smoke-test-discord-plays-pokemon`/`smoke-test-discord-plays-mario-kart`).
- Converted `discord-stream-lifecycle` from raw-TS-source consumption to a
  compiled `dist/` package (matching `llm-models`' proven pattern).
- Found and fixed a second, previously-latent bug in the Dagger pipeline's
  bun install step for nested-workspace consumers of pre-built `file:` deps.
- Verified via `dagger call` smoke tests for all three consumers (pokemon,
  mario-kart, streambot), plus local `tsc`/`eslint`/`bun test`.
- Files: `.dagger/src/base.ts`, `.dagger/src/deps.ts`, `.dagger/src/image.ts`,
  `packages/discord-stream-lifecycle/{package.json,bunfig.toml,tsconfig.build.json}`,
  28 consumer import-path updates across discord-plays-pokemon,
  discord-plays-mario-kart, streambot, discord-stream-lifecycle itself.

### Remaining

- Open the PR and merge once CI confirms green on the real Buildkite
  pipeline (not just local `dagger call` reproduction).

### Caveats

- The root cause of why splitting the clean-reinstall into separate `withExec`
  layers matters (vs one combined shell script) is NOT fully understood —
  documented as an empirically-verified workaround in
  `withCleanReinstallIfNeeded`'s doc comment, not a root-cause fix. If this
  class of bug resurfaces for a different `file:` dep in the future, revisit
  that function's doc comment first.
- This session's local dagger testing repeatedly hit a JSDoc gotcha: a
  comment containing the literal substring `packages/*/node_modules`
  (asterisk-slash) prematurely closes the enclosing `/** */` block comment,
  turning subsequent code into garbage syntax with confusing cascading error
  messages far from the actual bug. Worth a lint rule or at least a
  documented gotcha if this recurs.
