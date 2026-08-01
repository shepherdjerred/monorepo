---
id: plan-2026-07-30-homelab-audit-agent-task-schema-fix
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Fix `homelab-audit-daily` agent-task schema regression

## Context

`homelab-audit-daily` (a Temporal-scheduled `agentTaskWorkflow`, provider `claude`) has failed on every run since 2026-07-30 with:

```
Error: agent produced no structured output (expected --json-schema structured_output / --output-schema file)
    at parseAgentTaskResultPayload (packages/temporal/src/shared/agent-task.ts:173:15)
    at <anonymous> (packages/temporal/src/activities/agent-task.ts:426:21)
```

Confirmed against the live Temporal cluster (`temporal-ui.tailnet-1a49.ts.net`) and git history:

- Commit `b4dd81cc9` (2026-07-28, "fix(ci): restore observability acceptance reporting #1785") changed the single shared `AGENT_TASK_OUTPUT_JSON_SCHEMA` constant in `packages/temporal/src/shared/agent-task.ts` from a hand-written **plain** JSON Schema (optional fields simply absent from `required`) to one generated via OpenAI's `zodResponseFormat()` helper — **OpenAI Structured-Outputs "strict mode"** (every field in `required`, optional fields modeled as nullable, `additionalProperties:false` everywhere).
- That one constant is fed to **both** providers: Codex via `--output-schema <file>` and Claude via `--json-schema <inline>`. The PR's real motivation was fixing a genuine Codex-side bug (a prior schema omitted `followUp.provider` from `required`, which OpenAI's strict mode rejects). Codex (OpenAI's own CLI) handles the new strict schema correctly — confirmed by `ci-io-post-merge-impact` (provider `codex`) completing successfully today with it.
- **Leading hypothesis (unconfirmed): Claude Code CLI's `--json-schema` mishandles the strict/nullable dialect** — the theory is that, given it, Claude silently exits 0 with no `structured_output` field at all, rather than erroring. The supporting circumstantial evidence: `homelab-audit-daily` ran cleanly for 100+ days on the old plain schema, and 07-30 is the first run where this exact error appears cleanly (07-29's run was separately masked by a Claude weekly-quota 429; 07-17→07-28 had a distinct, still-unexplained non-zero-exit failure — see the two new todos filed below). This is correlation, not proof: as the empirical-verification caveat below records, local repro omitted `structured_output` with **both** schema dialects (including the historically-working plain one), and the model (`claude-opus-4-8`→`claude-opus-5`) and turn limit (8→40) also changed across the compared runs, so the schema dialect is not isolated as the cause. The production cron run (or an independent reproduction) is what will confirm or refute it.

The fix: stop sharing one JSON Schema constant between providers. Generate a plain/optional schema for Claude directly from the already-plain-optional canonical Zod schema (`AgentTaskResultPayloadSchema`), and keep today's strict/nullable schema for Codex exactly as-is.

This was independently confirmed by a Plan-agent review that read the live Zod v4.4.3 `toJSONSchema` source (`node_modules/zod/v4/core/{to-json-schema,json-schema-processors}.js`): for a plain (non-`.strict()`) object, `.optional()` fields are correctly excluded from `required`, no `anyOf`/null union is added, and the nested `AgentTaskFollowUpSchema`'s cross-field `.superRefine()` is safely ignored (JSON Schema can't express it anyway — the original hand-written schema never encoded it either). `z.toJSONSchema(AgentTaskResultPayloadSchema)` reproduces the known-working pre-07-28 shape with no special options; it just needs stripping the injected top-level `"$schema"` key it adds by default.

## Fix

### 1. `packages/temporal/src/shared/agent-task.ts`

- Rename `AGENT_TASK_OUTPUT_JSON_SCHEMA` → `AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX` (body unchanged — still `zodResponseFormat(AgentTaskWireResultPayloadSchema, "agent_task_result")`, still the OpenAI-strict/nullable dialect Codex needs).
- Add `AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE`, computed from `z.toJSONSchema(AgentTaskResultPayloadSchema)` with the injected `"$schema"` key stripped before assignment. Comment both constants clearly (which dialect, which provider, why they must stay separate — this is exactly the kind of gotcha `packages/temporal/CLAUDE.md` already documents for the file-path-wedge bug).
- Make `parseAgentTaskResultPayload` provider-aware: add a `provider: AgentTaskProvider` parameter (single function, not two — there's one call site with an existing if/else). Keep the `raw === undefined || raw === ""` guard verbatim. Branch inside the try: `claude` → parse directly against `AgentTaskResultPayloadSchema` (no wire/normalize indirection — Claude's output is already the canonical optional dialect once the schema fix lands); `codex` → today's existing wire-parse + `normalizeAgentTaskFollowUp` logic, unchanged. The outer catch (wraps parse errors) stays shared.
- `AgentTaskWireResultPayloadSchema` / `AgentTaskWireFollowUpSchema` / `normalizeAgentTaskFollowUp` become explicitly Codex-only — add a one-line comment noting this.

### 2. `packages/temporal/src/activities/agent-task-command.ts`

- Import both new constants instead of the single one.
- `writeOutputSchema` (called only from `codexCommand`) writes `AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX` — no behavior change for Codex.
- `claudeCommand`'s `--json-schema` arg becomes `JSON.stringify(AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE)` — this is the actual fix. Nothing else in `claudeCommand` changes.

### 3. `packages/temporal/src/activities/agent-task.ts` (lines ~423-438)

Bundle a second, related fix here (independently flagged by two exploration passes): add an `is_error` check on the Claude branch, mirroring the existing pattern in `packages/temporal/src/activities/homelab-audit.ts:359-376`. Today, any non-schema soft-failure (e.g. Claude hits `--max-turns` and its final message has `is_error: true` with no `structured_output`) collapses into the same opaque "no structured output" message. Pull `parseClaudeResultMessage(result.stdout)` into a local, check `is_error === true` and throw a clear, distinct error (`claude -p reported is_error=true for agent task: <result text>`) before reading `structured_output` — this throw stays inside the existing try block so it flows through the existing shared catch (metric increment + `captureWithContext` + rethrow), no duplicate reporting needed. Codex branch: unchanged except passing `provider` as the second arg to `parseAgentTaskResultPayload`.

### 4. Tests

- `packages/temporal/src/shared/agent-task.test.ts`: retarget the existing strict-schema test at `AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX`; add a new test asserting `AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE` has `required: ["markdown"]` only, nested `followUp.required: ["title","prompt"]` only, no `"$schema"` key, and no `anyOf`/nullable unions anywhere (the direct regression guard). Add a `provider` arg to every existing `parseAgentTaskResultPayload(...)` call (`"codex"` for the wire-shaped fixtures). Add new Claude-path tests: a plain/optional payload round-tripping with no wire keys, and a `followUp` missing both `runAt`/`cron` still throwing (now via `AgentTaskFollowUpSchema`'s own superRefine, distinct message).
- `packages/temporal/src/activities/agent-task-command.test.ts`: update the Codex assertion to compare against `AGENT_TASK_OUTPUT_JSON_SCHEMA_CODEX`; add a Claude-path test asserting the `--json-schema` arg deep-equals `AGENT_TASK_OUTPUT_JSON_SCHEMA_CLAUDE` and explicitly differs from the Codex constant (regression guard against re-merging them).
- `packages/temporal/src/activities/agent-task.test.ts`: today's only test exercises the Codex path — the Claude/`structured_output`/`is_error` branch has zero coverage. Add a Claude fixture + a small per-test command-builder stub emitting a real `stream-json` result-message line, and two new tests: a successful Claude structured*output parse, and an `is_error: true` case asserting the new distinct error message (and that it does \_not* match the old generic message).

### 5. Docs

- Append 1-2 sentences to the existing "`claude -p --json-schema` gotcha" section in `packages/temporal/CLAUDE.md`, documenting the two-constants split and why (Claude silently drops `structured_output` on the OpenAI-strict dialect instead of erroring) — prevents a future well-intentioned re-merge of the two schemas.
- Update the stale `packages/docs/todos/homelab-audit-agent-task-production-verification.md` — it currently claims "the historical timeout and JSON-schema invocation defects have code fixes" and asks to confirm 7 clean runs; replace with the actual finding (regression re-introduced 07-28, root-caused and fixed in this PR) and the concrete verification checklist (see below).
- File two new `packages/docs/todos/` entries for issues discovered but out of scope here (per "fix X means X" — don't fold unrelated bugs into this PR):
  - **Codex `ci-io-post-merge-impact` bwrap sandbox failure**: every run's shell commands fail with `bwrap: No permissions to create a new namespace` (codex's `--sandbox read-only` needs a Linux namespace the worker pod can't create). Commit `cda4e819e` on the still-unmerged branch `feature/codex-sandbox-danger-full-access` switches this to `--sandbox danger-full-access`, but it has **not landed on `main`** (both `main` and this branch still pass `--sandbox read-only`) — file a todo that gates verification on landing that branch first.
  - **Unexplained `homelab-audit-daily` non-zero-exit stretch, 2026-07-17 → 2026-07-28**: a distinct failure mode (`exited with code 1`, empty stdout tail) not explained by this schema regression and not diagnosable from Temporal history alone (stdout isn't retained for a non-retried single-attempt failure). Needs Loki/Sentry log review for that window. File as a `planned` todo, not fixed in this PR.

## Empirical verification caveat (added post-implementation)

Local reproduction of the fix was **inconclusive, not confirmatory**. Pulling the
actual production LLM trace archive (S3 `llm-archive` bucket) for every
`agent-task` claude invocation in July showed `finishReasons` correlating with
outcome (`end_turn` in the 07-06→07-16 success window and again on the 07-30
failure; `tool_use` throughout the unrelated 07-17→07-26 non-zero-exit failure
stretch; `stop_sequence` for the 07-27→07-29 quota window) — but the two
`end_turn` cases (07-16 success vs. 07-30 failure) are only distinguishable by
the schema shape (this fix), a model bump (`claude-opus-4-8`→`claude-opus-5`,
07-26), and a `maxTurns` bump (8→40).

Attempting to reproduce the mechanism locally against the exact pinned
production CLI (`@anthropic-ai/claude-code@2.1.175`, installed in an isolated
prefix) failed to populate `structured_output` under **any** combination of
schema (plain vs. strict), model (`claude-opus-4-8` vs. `claude-opus-5`),
output format (`json` vs. `stream-json`), or prompt style (trivial vs. the real
`reportOnlyPrompt` wrapper) — including the exact historically-working
configuration (plain schema + `claude-opus-4-8`). Since local repro can't even
reproduce the known-good case, it isn't a trustworthy oracle here (likely an
auth/entitlement or real-multi-tool-call difference between an interactive
session and the worker pod's `CLAUDE_CODE_OAUTH_TOKEN`), so **no empirical
before/after proof backs this fix**. The fix is still justified by code
archaeology (a real, confirmed schema-dialect regression, reverted to the
exact historically-stable shape) and is a strict improvement (plus the
`is_error` diagnostic), but the true verification is the next real
`homelab-audit-daily` cron firing in production — see the Verification section
below and the updated todo doc.

## Remaining

- [ ] Confirm the next real `homelab-audit-daily` cron run (`30 6 * * *` PT)
      completes successfully in production — tracked in
      `packages/docs/todos/homelab-audit-agent-task-production-verification.md`.
      Code changes in this plan are otherwise complete.

## Verification

1. `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal` — must pass with the updated/new tests above.
2. ~~Empirically confirm~~ Attempted and inconclusive — see the caveat above. Local repro of the pinned CLI never populates `structured_output` regardless of schema/model/format, so this could not be confirmed before merge. Real verification is step 4.
3. Open the PR from this worktree via git-spice, let Buildkite run the full `bun run verify` graph.
4. After merge/deploy, watch the next real `homelab-audit-daily` cron firing (`30 6 * * *` PT) via `https://temporal-ui.tailnet-1a49.ts.net` → Schedules → `homelab-audit-daily`, or query `temporal workflow list --query "WorkflowId STARTS_WITH 'homelab-audit-daily'"` (`TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 --tls`) — confirm `WORKFLOW_EXECUTION_STATUS_COMPLETED` and that the report email actually sent (Postal).
5. Update the todo doc's checklist once a clean run is observed, and archive it to `packages/docs/archive/completed/` if fully resolved.
