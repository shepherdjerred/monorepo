---
id: log-2026-06-13-fix-greptile-p2-codex-auth-envvalue
type: log
status: complete
board: false
---

# Fix Greptile P2: codex-auth.ts envValue simplification

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

## Follow-up: Greptile P1 — final report not truncated before Discord send

`readFinalReport` read the Codex `--output-last-message` file with no size cap,
then embedded the raw text in a Discord message. Discord rejects payloads over
2000 chars with a 400; the prompt asks Codex to summarize achievements/remaining/
state, so over-limit reports are the expected case. The completion message was
silently dropped and the user never learned the goal finished/failed.

### Fix

- New sibling module `goal/discord-message.ts` with `truncateForDiscord` (caps at
  the 2000 code-point limit, appends `… (truncated)`, truncates on grapheme
  boundaries via `Intl.Segmenter` so emoji/combining marks are never split).
  Moved `sanitizeDiscordText` into this module too (keeps `goal-manager.ts` under
  the 500-line cap — the extraction the previous caveat predicted).
- Wrapped both the final-report and progress completion messages in
  `truncateForDiscord` so the whole assembled payload (mention + prefix +
  sanitize expansion + report) always fits.
- Tests: `goal/discord-message.test.ts` (bound, indicator, grapheme safety,
  sanitize) + integration test in `goal-manager.test.ts` asserting a >2000-char
  report is delivered truncated to ≤2000 with the indicator, not dropped.
- Registered `src/goal/discord-message.test.ts` in `eslint.config.ts`
  `allowDefaultProject` (backend test files must be listed there; tsconfig already
  excludes `**/*.test.ts`).

Lint gotchas hit: `unicorn/prefer-spread` wants `[...str]` but
`@typescript-eslint/no-misused-spread` then bans spreading strings — resolved by
counting code points with a `for…of` loop and truncating via `Intl.Segmenter`
(no string spread anywhere). The new integration test pushed the `GoalManager`
describe arrow past the 200-line `max-lines-per-function` cap, so it lives in its
own `describe("GoalManager final report")` block.

## Follow-up: Greptile P1 — startGoal concurrency race

`startGoal` had awaits (`hasCodexCredential`, `Bun.write`, `prepareRuntimeTools`)
before `this.active` was assigned. Two `/goal` interactions arriving within ms
both read `this.active === undefined`, both passed the lock check, both spawned a
Codex process — but only the second was stored in `this.active`, orphaning the
first (which kept pressing buttons and burning API credits with no kill handle).

### Fix

- Added a synchronous `this.starting` flag claimed at the top of `startGoal`,
  before the first await. A second concurrent call sees it set and returns a new
  `"busy"` `StartGoalResult` instead of spawning. JS is single-threaded, so the
  check-and-set fully closes the window. Cleared in a `finally` so a failed/early
  start never wedges the lock. The spawn path moved into `startGoalLocked`.
- To stay under the 500-line `max-lines` cap, extracted `buildCodexArgs` /
  `buildPrompt` into a new pure module `goal/codex-command.ts` (no GoalManager
  state beyond the two config fields, passed as a small `CodexCommandConfig`).
- Test (own `describe("GoalManager concurrency")` block): two near-simultaneous
  `startGoal` calls now yield exactly one spawned process and a `"busy"` loser.

The `"busy"` kind needed no consumer change — `discord/.../goal.ts` only reads
`result.content`/`result.ephemeral`, not `kind`.

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
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWRSx` (confirmed `isResolved: true`)
- Follow-up: fixed Greptile P1 in
  `packages/discord-plays-pokemon/packages/backend/src/goal/goal-manager.ts` — goal
  final report (and progress) now truncated to Discord's 2000-char limit via a new
  `goal/discord-message.ts` helper; added unit + integration tests
- Committed as `7a583dd52` (fix(discord-plays-pokemon): truncate goal final report to Discord limit)
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWbZh` (confirmed `isResolved: true`)
- Follow-up: fixed Greptile P1 concurrency race in
  `packages/discord-plays-pokemon/packages/backend/src/goal/goal-manager.ts` —
  synchronous `this.starting` lock + new `"busy"` result; extracted
  `buildCodexArgs`/`buildPrompt` to `goal/codex-command.ts`; added concurrency test
- Committed as `fd38c9d79` (fix(discord-plays-pokemon): close startGoal concurrency race)
- Pushed to `feature/pokemon-goal-mode`
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWg9n` (confirmed `isResolved: true`)

### Remaining

- None — CI should now pass the `mag-greptile-review` gate

### Caveats

- The worktree at `.claude/worktrees/pr-1144` already existed with the first fix pre-applied in
  the working tree (not yet committed). Committed and pushed that existing change.
- The repo bans `.then()` chaining via `custom-rules/prefer-async-await`; do not paste Greptile
  suggestions that use `.then()` verbatim — convert to async/await first.
- `goal-manager.ts` keeps bumping the 500-line `max-lines` cap; it's at ~489 now after
  extractions. Discord-message helpers live in `goal/discord-message.ts`; Codex command/prompt
  building lives in `goal/codex-command.ts`. Put new cohesive logic in a sibling module, not
  inline — every addition to goal-manager risks re-crossing the cap.
- Backend test files must be registered in `eslint.config.ts` `allowDefaultProject` (cap 10,
  currently 9) AND are excluded from tsconfig via `**/*.test.ts` — new backend tests need the
  allowDefaultProject entry or eslint errors "not found by the project service".
- String code-point work trips a lint conflict: `unicorn/prefer-spread` vs
  `@typescript-eslint/no-misused-spread`. Use a `for…of` count + `Intl.Segmenter`, never
  `[...str]`, to satisfy both without suppressions.
