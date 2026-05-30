# Opus 4.8 model reference bump

## Status

Complete

## Context

Opus 4.8 (`claude-opus-4-8`) was released. This session bumped all **active-code**
references that select the latest Opus model from `claude-opus-4-7` (and
`claude-opus-4-6` in the Buildkite scripts) to `claude-opus-4-8`.

Sonnet 4.6 (`claude-sonnet-4-6`) and Haiku 4.5 (`claude-haiku-4-5*`) references were
**left unchanged** — they are deliberate tier choices, not "latest Opus" references, and
an Opus release does not introduce a new Sonnet/Haiku.

## Files changed

Production source (constants):

- `packages/temporal/src/activities/agent-task-command.ts` — `DEFAULT_CLAUDE_MODEL`
- `packages/temporal/src/activities/scout-season-refresh.ts` — `DEFAULT_MODEL`
- `packages/temporal/src/activities/homelab-audit.ts` — `DEFAULT_MODEL`
- `packages/temporal/src/activities/pr-review/specialists/correctness.ts` — `CORRECTNESS_MODEL` + doc comment
- `packages/temporal/src/activities/pr-review/specialists/security.ts` — `SECURITY_MODEL` + doc comment
- `packages/temporal/src/activities/pr-review/specialists/perf.ts` — `PERF_MODEL` + doc comment
- `packages/temporal/src/activities/pr-review/specialists/runner.ts` — doc comments only
- `packages/temporal/src/activities/pr-review/specialists.ts` — doc comments
- `packages/temporal/src/activities/pr-review/consensus.ts` — doc comments
- `packages/temporal/src/activities/pr-review/metrics.ts` — doc comment example label

Buildkite scripts:

- `.buildkite/scripts/code-review.sh` — `--model` (was `claude-opus-4-6`)
- `.buildkite/scripts/code-review-interactive.sh` — `--model` (was `claude-opus-4-6`)

Tests / fixtures (updated in lockstep with the source constants they assert):

- `packages/temporal/src/activities/pr-review/specialists/runner.test.ts`
- `packages/temporal/src/activities/pr-review/metrics.test.ts`
- `packages/temporal/src/workflows/homelab-audit.test.ts`

Tooling / docs (current-state):

- `packages/temporal/scripts/replay-pr-review.ts` — stderr banner string
- `packages/temporal/AGENTS.md` — "Models" line (mirrored to `CLAUDE.md`)

## Deliberately NOT changed

- `archive/**` — CLAUDE.md marks archive projects as do-not-modify (clauderon, tips, glance, bun-decompile).
- `poc/**`, `practice/**` — POCs pinned to older Sonnet snapshots (`claude-sonnet-4-20250514`); not "latest Opus".
- `packages/docs/plans/2026-05-10_sota-pr-review-bot.md` and `packages/docs/archive/**` —
  historical design records (cost tables, decisions) that describe the model chosen at
  the time. Rewriting them would falsify the record.
- All Sonnet 4.6 / Haiku 4.5 references (monarch, llm-observability, summary path, deps/convention specialists).

## Session Log — 2026-05-29

### Done

- Bumped every active-code "latest Opus" reference to `claude-opus-4-8` across the
  temporal package (6 source constants + doc comments), both Buildkite review scripts,
  the replay CLI banner, temporal `AGENTS.md`, and the three test files that assert the
  model id.

### Remaining

- None for the requested scope. If a future maintainer wants the historical plan docs to
  reflect 4.8, that is a separate, optional doc-rewrite decision.

### Caveats

- Tests were **not** executed: this fresh worktree has no `node_modules`
  (`@temporalio/*`, `prom-client` missing), so `bun test` errors on imports unrelated to
  the change. Run `bun run scripts/setup.ts` then `bun test` in `packages/temporal` to
  verify before merging. The edits are pure string-literal swaps (type unchanged), and
  the asserting tests were updated in lockstep, so behavior risk is low.
- The `"xhigh"` SDK comments in `runner.ts`/`correctness.ts` retain the factual
  "added in 4.7" note — that records when the effort tier landed and is not a model-pin.
