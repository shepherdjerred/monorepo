# Fix Greptile P2: codex-auth.ts envValue simplification

## Status

Complete

## Context

PR #1144 (feature/pokemon-goal-mode, DRAFT) had one unresolved Greptile P2 review comment
blocking the `mag-greptile-review` gate. The comment was on
`packages/discord-plays-pokemon/packages/backend/src/goal/codex-auth.ts:12`.

## Problem

`envValue` used `Object.entries(values).find(([key]) => key === name)?.[1]` — an O(n)
iterator for what is simply a property lookup. Greptile flagged it as unnecessarily complex.

## Fix

Replaced with a direct index access: `const value = values[name];`. Functionally equivalent
for `Record<string, string | undefined>` but O(1) and much more readable.

## Verification

- `bun run --filter='@discord-plays-pokemon/backend' typecheck` — exit 0
- Pre-commit hooks: all pass (ESLint, prettier, tests, quality-ratchet, typecheck)
- Greptile thread `PRRT_kwDOHf4r4c6JWAfD` resolved via GraphQL mutation

## Follow-up: Greptile P1 — SIGTERM handler never terminates the process

After the first push, Greptile re-reviewed and posted a P1 on
`packages/discord-plays-pokemon/packages/backend/src/index.ts:241`.

### Problem

The `process.once("SIGTERM"/"SIGINT", () => void shutdown())` handlers suppress the
default signal-based termination. After `shutdown()` resolves, the Discord.js WebSocket
and Bun.serve listeners keep the event loop alive, so the process hangs until Kubernetes
force-kills it with SIGKILL during the grace period.

### Fix

Added an `async function shutdownAndExit()` that `await shutdown()` then `process.exit(0)`,
and call it from both signal handlers. Greptile's literal suggestion used `.then()` chaining,
which the repo's custom ESLint rule `custom-rules/prefer-async-await` bans — so the fix uses
an awaited helper instead of `.then()`.

## Follow-up: Greptile P1 SECURITY — prompt-injection secret exfiltration

`goal-manager.ts buildEnvironment` copied the entire `Bun.env` into the Codex
subprocess (DISCORD_TOKEN, CODEX_API_KEY, every secret). The user-supplied goal
is embedded verbatim in the Codex prompt, and `pokemonctl progress` relays text
straight to Discord, so a prompt-injected goal could exfiltrate secrets.

### Fix

- Replaced the "copy all of `Bun.env`" loop with an explicit allowlist
  (`inheritedEnvironmentAllowlist`): `PATH`, `HOME`, `CODEX_HOME`,
  `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, `OPENAI_API_KEY`. PATH and the
  `POKEMONCTL_*` control vars are still injected explicitly in the return.
- Secondary hardening: the goal is now clearly delimited as untrusted user input
  in `buildPrompt` with an instruction not to follow embedded directions or
  reveal secrets.
- Added a regression test asserting `DISCORD_TOKEN` is NOT forwarded to the
  spawned subprocess while the Codex credential still is.

Note: this fix pushed `goal-manager.ts` over the 500-line `max-lines` ESLint cap;
trimmed by collapsing prompt blank-line array entries into `\n`-embedded strings
(rendered prompt unchanged) and folding multi-line warning prose into one entry.

## Session Log — 2026-06-13

### Done

- Applied fix to `packages/discord-plays-pokemon/packages/backend/src/goal/codex-auth.ts`
- Committed as `231d632f5` (fix(discord-plays-pokemon): simplify envValue to use direct property lookup)
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWAfD` (confirmed `isResolved: true`)
- Follow-up: fixed Greptile P1 in `packages/discord-plays-pokemon/packages/backend/src/index.ts`
  — signal handlers now exit the process after graceful shutdown
- Committed as `3293fa78d` (fix(discord-plays-pokemon): exit process after SIGTERM shutdown)
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWNFM` (confirmed `isResolved: true`)
- Follow-up: fixed Greptile P1 SECURITY in
  `packages/discord-plays-pokemon/packages/backend/src/goal/goal-manager.ts` —
  Codex subprocess env now restricted to an allowlist + goal delimited as
  untrusted; added regression test in `goal-manager.test.ts`
- Committed as `e5dcc5e4e` (fix(discord-plays-pokemon): restrict codex subprocess env to an allowlist)
- Pushed to `feature/pokemon-goal-mode`
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWRSx` (confirmed `isResolved: true`)

### Remaining

- None — CI should now pass the `mag-greptile-review` gate

### Caveats

- The worktree at `.claude/worktrees/pr-1144` already existed with the first fix pre-applied in
  the working tree (not yet committed). Committed and pushed that existing change.
- The repo bans `.then()` chaining via `custom-rules/prefer-async-await`; do not paste Greptile
  suggestions that use `.then()` verbatim — convert to async/await first.
- `goal-manager.ts` is now near the 500-line `max-lines` cap; further additions will need an
  extraction (e.g. move `buildPrompt` to its own module) rather than inline growth.
