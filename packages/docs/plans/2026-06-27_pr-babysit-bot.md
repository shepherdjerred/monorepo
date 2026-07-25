---
id: plan-2026-06-27-pr-babysit-bot
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# PR Babysitter Bot — GitHub-native "get this green" automation

## Status Notes (Historical)

In Progress — **Phases 0–3 implemented**, all in one PR (#1334), the whole
feature landing **dormant** behind `PR_BABYSIT_ENABLED` (default off):

- **Phase 0** — local PoC + reusable core; validated by dogfooding on #1334
  itself (the babysitter autonomously fixed two P1s + resolved its own review
  threads). 48 unit tests.
- **Phase 1** — durable `prBabysitWorkflow` on a dedicated `PR_BABYSIT` queue
  (signals/query, `decideNextAction` reused, guidance blocking, budget + stuck
  guards, `continueAsNew`); 5th worker registered.
- **Phase 2** — `issue_comment` ingress + owner-only authz + command parser
  (`@temporal-worker help|stop|status`) + start/signal/query routing + 👍 ack +
  single marker status comment; gated by `PR_BABYSIT_ENABLED`.
- **Phase 3** — tofu subscribes `pr_bot` to `issue_comment`; worker env adds
  the kill switch (off) + handle/login + concurrency cap.

Phases 4–5 are **operational, post-merge** (live test on a throwaway PR, then
flip `PR_BABYSIT_ENABLED=true`) — not PR content. Run-time gate verified green
across temporal (655 tests) + homelab (typecheck/lint/1P-linter/tofu fmt).

## Context

Today you manually spin up a Claude orchestrator on your Mac that drives every open PR on
`shepherdjerred/monorepo` to "ready to merge" — CI green (ignoring soft Buildkite failures), no
merge conflicts vs `origin/main` (verified by a **real local merge-tree**, never the lying gh API),
and no unresolved P3+ review comments (incl. Greptile "comments" / "comments outside of diff"). One
subagent per PR, looping every 1–3 min, fixing → committing → pushing, escalating to you only when a
fix would break the PR's intent. The `2026-06-27_pr-babysit-*.md` logs are a real run of this.

**Goal:** make that flow GitHub-native. You comment `@temporal-worker help me get this green` on a
PR; a bot runs the loop, pushes fixes as the app bot, replies when it needs guidance, and you can
steer or stop by replying. Never merges/closes. Must be cheap (no token burn when idle) and stoppable.

**Why this is mostly an integration job, not a greenfield build:** ~80% of the plumbing already
exists and is in production:

| Already built                                                                               | Where                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GitHub App (mints install tokens, posts as `temporal-worker[bot]`)                          | `packages/temporal/src/lib/github-app-token.ts`                                     |
| Public webhook ingress `pr-bot.sjer.red/webhook` (HMAC-verified, Hono)                      | `src/event-bridge/github-webhook.ts` + `http-services.ts` (CF Tunnel)               |
| Headless `claude -p` runner: heartbeats, soft-kill 90s pre-timeout, redaction, cancellation | `src/shared/agent-subprocess.ts`, `src/activities/agent-task.ts`                    |
| Durable per-entity loop pattern (signal + `condition`-timeout + `continueAsNew`)            | `src/workflows/ha/reconcile-lock.ts`, `src/workflows/pr-reaction-listener/`         |
| **Real** merge-tree conflict check (not gh `mergeable`)                                     | `src/activities/check-pr-merge-conflicts-git.ts`                                    |
| `signalWithStart` start/route pattern                                                       | `src/event-bridge/triggers.ts`, `conflict-check-starts.ts`                          |
| Single status comment via hidden marker (upsert, no spam)                                   | `src/activities/pr-review/post-github.ts` (`findExistingComment`), `post-render.ts` |
| Per-run cost knobs (`agentTimeoutMinutes`≤90, `maxTurns`, K8s limits)                       | `src/workflows/agent-task.ts`                                                       |

**The one fundamental gap:** every existing agent path is hard-locked to `report-only` —
`AgentTaskModeSchema = z.enum(["report-only"])`, read-only tools (`Bash,Read,Grep,Glob,WebFetch`),
and `reportOnlyPrompt()` explicitly bans commit/push (`src/shared/agent-task.ts:4`, `:205`). The
babysitter must **mutate**: edit, commit, push to the PR branch, reply to/resolve Greptile threads.
That write capability — plus a durable loop and budget enforcement — is what's new.

## Decisions (locked)

- **Trigger:** comment parsed by the **existing** `temporal-worker[bot]` app. No new GitHub App.
  Add `issue_comment` to the webhook. Handle is any token our parser matches (default
  `@temporal-worker`); GitHub delivers every comment regardless of mention, so reuse is clean.
- **Authz:** **owner-only** — `author_association === "OWNER"` AND `login === "shepherdjerred"`.
  Unauthorized → silent ignore (counter + log, no reply/reaction — no abuse surface on a public repo).
- **Build approach:** full design below, but **Phase 0 (local PoC) ships first** to validate the loop
  and **measure real $/PR** before any cluster/ingress work. Budget defaults are set from those numbers.

## Architecture at a glance

A new dedicated workflow `prBabysitWorkflow` (do **not** overload report-only `agentTaskWorkflow` — it
would weaken the read-only guarantee homelab-audit etc. rely on). One durable workflow per PR, id
`pr-babysit-<owner>-<repo>-<number>`, on a new `TASK_QUEUES.PR_BABYSIT` queue. Event-driven, not
poll-driven (this is the token saver):

```
comment "@temporal-worker help…"  ──issue_comment──▶  webhook (authz, parse)
                                                          │ signalWithStart
                                                          ▼
   ┌───────────────────────── prBabysitWorkflow (per PR) ─────────────────────────┐
   │ ensureWorkdir → loop:                                                         │
   │   evaluateBabysitDoD  ── deterministic gate (cheap; NO llm) ──┐               │
   │     CI(Buildkite via gh checks, soft-fails filtered)          │               │
   │     conflicts(local merge-tree vs main)                       │ dodMet?       │
   │     reviewThreads(GraphQL, P3+ incl Greptile)                 │               │
   │   ├ dodMet  → post "green" status → light-monitor (long wait, wakes on event) │
   │   └ broken  → runBabysitIteration (claude -p, WRITE tools) → pushBranch       │
   │              → await CI (wake on webhook signal, timer fallback)              │
   │   needsGuidance/intentConflict → post question → block on `guidance` signal   │
   │   budget exhausted / stuck / stop signal → stand down + status comment        │
   │ continueAsNew every N iters (bound history); cleanup only on terminal         │
   └──────────────────────────────────────────────────────────────────────────────┘
        ▲ signals fed by webhook: ciCompleted, branchPushed, reviewActivity,
          mainAdvanced, guidance, stop   (query: getStatus)
```

**Why an LLM turn only fires when DoD is known-broken:** the gate is cheap deterministic REST/GraphQL +
a local `git merge-tree`. Idle/green PRs cost ~nothing; the agent runs only to fix a real failure.

## Definition of Done (the gate) — `evaluateBabysitDoD` activity

Deterministic activity, **not** the agent's self-report (replay-safe, queryable, cheap, testable —
same philosophy as the existing merge-tree check). Returns `BabysitVerdict { ci, conflicts, reviews,
dodMet, prState, headSha }`. `dodMet = ci.green && conflicts.clean && reviews.allResolved`.

1. **CI** — `gh pr checks` / Octokit combined status on `headSha`; filter out soft contexts
   (`scissors-knip`, `shield-trivy-scan`, `semgrep*`, and Greptile's review-_completion_ check which
   goes green on complete, not on resolve). Green = every non-soft context success/neutral/skipped and
   none pending. (Buildkite reports to GitHub as `buildkite/monorepo/pr/...` status checks, so gh sees it.)
2. **Conflicts** — reuse `defaultRunMergeTree` + `parseConflictPaths` from
   `check-pr-merge-conflicts-git.ts` against the persistent workdir (`git fetch origin main` →
   merge-tree HEAD vs main). Never the gh `mergeable` field.
3. **Review threads** — new GraphQL reader: `reviewThreads(first:100){ isResolved comments{ author body }}`
   - Greptile "outside of diff" issue/review comments by `greptile-apps[bot]`; parse `P1/P2/P3`.
     `allResolved` = no unresolved thread carrying P3-or-higher. (Greptile's status check is NOT the gate.)

The agent's `dodMetSelfReport` is logged for divergence metrics but never terminates the loop.

## Piece 1 — `prBabysitWorkflow` (the durable loop)

New files under `packages/temporal/src/`:

| File                                         | Role                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `shared/pr-babysit/types.ts`                 | Zod input/verdict/output schemas + `BABYSIT_ITERATION_OUTPUT_SCHEMA` (pure — no Sentry/obs imports, per the `bundle.test.ts` rule) |
| `shared/pr-babysit/prompt.ts`                | `babysitIterationPrompt()`, `failureSignature()`, soft-failure matcher (pure)                                                      |
| `shared/pr-babysit/workflow-id.ts`           | `prBabysitWorkflowId(owner,repo,n)` (reuses `sanitizeTemporalIdPart`)                                                              |
| `workflows/pr-babysit/index.ts`              | `prBabysitWorkflow` — loop, signals, queries, `continueAsNew`                                                                      |
| `activities/pr-babysit/ensure-workdir.ts`    | `ensureBabysitWorkdir` — idempotent persistent checkout (clone-or-`fetch+reset --hard origin/<headRef>`)                           |
| `activities/pr-babysit/evaluate-dod.ts`      | `evaluateBabysitDoD` (the gate above)                                                                                              |
| `activities/pr-babysit/iteration.ts`         | `runBabysitIteration` — mutating `claude -p`                                                                                       |
| `activities/pr-babysit/iteration-command.ts` | `buildBabysitIterationCommand` — write-tool argv                                                                                   |
| `activities/pr-babysit/github.ts`            | `pushBabysitBranch`, `postBabysitComment`, review-thread GraphQL                                                                   |
| `event-bridge/babysit-starts.ts`             | `signalOrStart*` helpers (the webhook→Temporal seam)                                                                               |

Edits: `shared/task-queues.ts` (+`PR_BABYSIT`), `worker.ts` (+5th worker, low
`maxConcurrentActivityTaskExecutions`), `workflows/index.ts` (export).

**Control loop** (model on `reconcile-lock.ts` for signal+`condition` waits, `pr-reaction-listener` for
bounded-iters→`continueAsNew` carrying state). Phases back a `getStatus` query: `assessing → fixing →
pushing → awaiting-ci → … → light-monitor / awaiting-guidance / standing-down / done`.

- **Signals** (each bumps an `events` counter + stashes payload; loop waits via
  `condition(() => events !== seen, fallbackMs)`): `ciCompleted{headSha,checkName,conclusion}`,
  `branchPushed{headSha}`, `reviewActivity{kind,author}`, `mainAdvanced{mainSha}`,
  `guidance{text,author,commentId}`, `stop{reason}`. **Query:** `getStatus → { phase, lastVerdict,
iterationsTotal, costUsd, budget, awaitingGuidanceQuestion? }`.
- **Event-driven + timer fallback:** wake on signals; `activePollFallbackMs` (~150s) bounds the
  awaiting-CI wait, `lightMonitorIntervalMinutes` (1–30) bounds green, so a dropped webhook can't wedge it.
- **`signalWithStart`** (webhook): `pull_request` opened/synchronize/reopened carry full context → start;
  sha-only events (`check_run`/`status`) → `getHandle(id).signal(...)`, swallow `WorkflowNotFoundError`
  (next PR event starts it). `workflowIdReusePolicy: ALLOW_DUPLICATE` + `workflowIdConflictPolicy:
USE_EXISTING` (signal the live run, never terminate it).

**Mutating iteration** (`runBabysitIteration`): clone the full `runTrackedAgentSubprocess` wiring from
`activities/agent-task.ts` (metrics/Sentry/heartbeat/result-parse), change only component
(`pr-babysit`), command, prompt, schema. `buildBabysitIterationCommand` forks `claudeCommand` in
`agent-task-command.ts` with `--allowed-tools "Bash,Read,Grep,Glob,Edit,Write,WebFetch"` and
`babysitIterationPrompt` (NOT `reportOnlyPrompt`). Agent edits + `git commit -- <specific paths>`
(prompt hard-bans `git add -A`/`.` per repo rule), returns `BABYSIT_ITERATION_OUTPUT_SCHEMA`:
`{ summary, actionsTaken[], committed, changedPaths[], commitMessage, dodMetSelfReport, needsGuidance,
guidanceQuestion?, intentConflict, escalationReason?, costUsd, numTurns }`.

- **Persistent workdir** keyed on stable `workflowId` (kept across iterations/`continueAsNew`, cleaned
  only on terminal). Absent → re-clone (`--filter=blob:none`); present → `fetch + reset --hard
origin/<headRef>` (origin is authoritative; we always push at end of iteration).
- **Push decoupled from the agent** (token TTL ~1h, an iteration can outlive it): agent returns after
  commit; workflow then calls deterministic `pushBabysitBranch`, which mints a **fresh** install token
  and `git push --force-with-lease origin HEAD:<headRef>` (GIT_ASKPASS pattern from
  `scout-season-refresh-git.ts`). `--force-with-lease` against `lastPushedSha` won't clobber a human
  push (lease fail → re-assess). `pushBabysitBranch` also enforces a **path-scope guard** (reject if the
  diff touches paths the agent didn't report / sensitive files).

**Failure handling:** deterministic activities retry (3–5, backoff); `runBabysitIteration` is
`maximumAttempts: 1` (never auto-retry an LLM mutation — workflow decides). Infinite-fix guard:
`failureSignature(verdict)` = hash of sorted (ci.failing ++ conflict.paths ++ unresolvedThreadIds);
same signature `stuckThreshold` (3) times → escalate to guidance / stand down. Sentry at activity level,
tag `component: pr-babysit`; terminal stand-downs also post a PR comment.

## Piece 2 — comment ingress, authz, safety (around the workflow)

Edits to `packages/temporal/src/event-bridge/`:

- **`github-webhook.ts`** — add an `if (event === "issue_comment")` branch (after `push`, before the
  `non-pull-request-event` skip that currently eats it) → `handleIssueCommentEvent`. Reuse
  `verifyWebhookSignature` verbatim. Gate `action === "created"` (ignore edited/deleted). Require
  `issue.pull_request` present (issue_comment also fires on plain issues); PR number = `issue.number`.
  Loop-protection: drop if author is a bot / `[bot]` / our app login. Plug into the existing
  `WebhookHooks` DI seam (`babysit: { start, signalStop, queryStatus, signalGuidance, postAck }`) so
  `github-webhook.test.ts` drives it without Temporal/GitHub.
- **`github-webhook-schema.ts`** — `IssueCommentEventSchema` (`zod/v4`, reuse `RepoSchema`; fields:
  `comment.{id,body,user.{login,type},author_association,performed_via_github_app}`,
  `issue.{number,pull_request?}`). `babysitCommandAuthz(comment)` mirroring `disallowedAuthorReason`
  (OWNER assoc AND login allowlist).
- **`babysit-command.ts`** (new, pure) — `parseBabysitCommand(body, handle) → { kind:
start|stop|status|none, force?, instruction? }`. Handle must be the **first non-whitespace token**
  (anchored, case-insensitive); verbs: start (`help|babysit|start|go|green`), stop
  (`stop|cancel|halt|abort` + optional `force`), status (`status|?`); handle-but-no-verb → start with
  remainder as goal. A **plain reply without the handle** counts as `guidance` only when the author is
  authorized AND the PR's workflow exists and is in `awaiting-guidance` (cheap `describe`+`query` — only
  for authorized authors, so normal discussion costs zero Temporal calls).
- **`babysit-starts.ts`** (new) — `signalWithStart` for start; `getHandle().signal/query` for
  stop/status/guidance; catch `WorkflowNotFoundError`.

**Ack/feedback UX:** on accepted command the ingress posts 👍 (`reactions.createForIssueComment`)
synchronously before 200. One status comment per PR under marker `<!-- pr-babysit-status -->` (reuse
`findExistingComment` upsert) rewritten through lifecycle: started → awaiting-guidance (the question) →
done (DoD summary) → budget-exhausted (which ceiling) → stopped. Bot-authored, so loop-protection stops
self-triggering.

## Cost / token safety (layered, outermost first)

1. **Global kill switch** `PR_BABYSIT_ENABLED` (env, **default `false`**), read per-request like
   `isPrBotEnabled()`. **Independent of `PR_BOT_ENABLED`** (which is currently `false` from the review-bot
   429 incident — must not entangle).
2. **Per-PR concurrency = 1** (deterministic id + `USE_EXISTING`).
3. **Global cap** `PR_BABYSIT_MAX_CONCURRENT` (default 1): at ingress, count running babysit workflows
   via `client.workflow.list`; over cap → reject (`queue_full`) + one owner-visible reply. Backstop: the
   dedicated `PR_BABYSIT` queue's low `maxConcurrentActivityTaskExecutions`.
4. **Per-PR budget** (workflow-enforced; ingress sets ceilings): `maxIterations` (~12),
   `workflowExecutionTimeout` (hard server wall-clock, ~6h), `maxIdleMinutes` (abort if guidance never
   answered), `hardCostCeilingUsd` (sum `costUsd` from each iteration → stop), `noProgressLimit`
   (K iters with no greener CI / fewer conflicts / newly-resolved comments → stop). Per-iteration:
   `agentTimeoutMinutes`≤90, `maxTurns`, soft-kill — all reused.
5. **Reliable stop:** `@…stop` → `stop` signal, loop reacts at next `condition` boundary, posts
   "stopped". `@…stop force` additionally `handle.cancel()` → Temporal cancels the activity → subprocess
   torn down. Graceful default, force escape hatch.

**Caveat (flag in plan):** budget is **per workflow run**; a later webhook `signalWithStart`s a fresh
run with a fresh budget. A true cumulative per-PR cap needs external persistence — out of scope, noted.

## Observability

Add to `src/observability/metrics.ts` (`pr_babysit_` namespace, one `register`):
`pr_babysit_commands_total{command,outcome}` (outcome: accepted|unauthorized|disabled|queue_full|
no_workflow|ignored|parse_failed), `pr_babysit_workflows_total{outcome}`,
`pr_babysit_iterations_per_pr` (histogram), `pr_babysit_cost_usd` + `pr_babysit_tokens_total` (mirror
`prSummaryCostUsd`), `pr_babysit_budget_exhausted_total{reason}`, `pr_babysit_escalations_total`,
`pr_babysit_active` (gauge). Reuse `agentSubprocessIdleSeconds` / `agentSubprocessSoftKillsTotal` with
`workflow_type="prBabysitWorkflow"`. Every command (incl. rejected) logs author/association/outcome
under `pr-webhook`; workflow under new component `pr-babysit`.

## Phased rollout & gates

| Phase                                      | Scope                                                                                                                                                                                                                      | Gate to pass before next                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Local PoC**                          | `scripts/run-pr-babysit-local.ts` (mirror `scripts/run-homelab-audit-local.ts`, `op run --env-file`). Runs the loop against **one real open owner PR** from your Mac, pushes to its branch.                                | Loop drives a real PR to green; mutation + DoD correct; **measured $/iteration + $/PR** recorded → becomes Phase-4 budget defaults.                                                                |
| **1 — Workflow (switch OFF)**              | Land `prBabysitWorkflow` + activities + `PR_BABYSIT` queue/worker. Add `PR_BABYSIT_ENABLED=false`, `PR_BABYSIT_MAX_CONCURRENT`, `PR_BABYSIT_BOT_HANDLE/LOGIN` to `worker.ts`. No ingress.                                  | `bun run typecheck`, `bun test` (incl. `workflows/bundle.test.ts` smoke), worker boots, new queue registers, zero behavior change.                                                                 |
| **2 — Ingress + authz (OFF, no tofu)**     | `issue_comment` handler, `IssueCommentEventSchema`, `parseBabysitCommand`, `babysitCommandAuthz`, `WebhookHooks.babysit`.                                                                                                  | `github-webhook.test.ts`: sig reuse, not-a-PR/edit/delete/self/unauthorized ignore, each verb → right hook, plain-reply→guidance only when awaiting-guidance. No real deliveries (tofu untouched). |
| **3 — Subscribe (tofu, switch still OFF)** | Add `"issue_comment"` to `pr_bot` events in `homelab/src/tofu/github/webhooks.tf`; `tofu apply`.                                                                                                                           | GitHub "Recent Deliveries" 200s; logs show received+disabled-skip; **zero** workflows started; no comments.                                                                                        |
| **4 — Owner-only live test**               | `PR_BABYSIT_ENABLED=true`, cap 1, Phase-0 budgets, on a **throwaway PR**. Exercise full grammar: babysit (👍+status) → drive green → status → plain-reply guidance → stop / stop force. Second account → silently ignored. | Full lifecycle observed; stop is prompt; cost within budget; single status comment updates in place; no self-trigger loop.                                                                         |
| **5 — Enable + ratchet**                   | Keep budgets conservative; watch dashboard ~1 week; then raise cap / iteration / cost ceilings.                                                                                                                            | —                                                                                                                                                                                                  |

## Verification

- **Phase 0 (the real proof):** `op run --env-file=.env.babysit -- bun run scripts/run-pr-babysit-local.ts --pr <#>`
  against a real failing-CI PR; confirm it fixes → commits → pushes → re-checks → reports green, and
  prints total `$` + per-iteration cost. This validates the load-bearing assumption (a mutating loop
  can converge) and sets budgets — before any infra. (Matches the repo's "validate e2e before buildout".)
- **Per package:** `cd packages/temporal && bun run typecheck && bun test && bunx eslint .` after each
  phase. The workflow-bundle smoke test (`src/workflows/bundle.test.ts`) catches accidental
  activity/Sentry imports leaking into the workflow file — keep pure helpers in `shared/pr-babysit/`.
- **Infra:** `cd packages/homelab && bun run test` (cdk8s/tofu validate) after the worker.ts + tofu edits.
- **Live (Phase 4):** throwaway PR, watch Temporal UI (`temporal-ui.tailnet-1a49.ts.net`) for the
  workflow + Loki `{component="pr-babysit"}` + the `pr_babysit_*` metrics.

## Open items / caveats

- **Per-run vs per-PR budget:** a re-triggered babysitter gets a fresh budget (above). Acceptable for v1.
- **Greptile thread resolution:** resolving via GraphQL is how the manual flow passes the gate (the
  Greptile status check goes green on review-complete, not on resolve). The agent must resolve threads,
  not just reply — encode in `babysitIterationPrompt` + verify in the DoD reader.
- **Workdir locality** isn't a Temporal guarantee; correct under single-pod reality + re-clone-on-absent.
- **`maxTurns`/`agentTimeoutMinutes`≤90** cap a single iteration; the loop spans many iterations via the
  workflow, so long convergence is fine without raising those caps.
- A thin alternative (extend `agentTaskWorkflow` with a mutate mode + cron self-loop) was rejected:
  blind-polling burns tokens and doesn't match the manual flow's responsiveness; the dedicated
  event-driven workflow is both more responsive and cheaper when idle.

## Phase 0 — implemented (this session)

The reusable core + local PoC driver landed on `feature/pr-babysit-bot`. The decision logic is
pure and unit-tested; the I/O activities run unchanged locally and (later) from a Temporal activity
(the shared `runTrackedAgentSubprocess` guards every `Context.current()` call for "outside Temporal").

| File                                                               | Role                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `packages/temporal/src/shared/pr-babysit/types.ts`                 | Zod input/verdict/iteration schemas + `BABYSIT_ITERATION_OUTPUT_JSON_SCHEMA` + budget defaults (pure)            |
| `packages/temporal/src/shared/pr-babysit/dod.ts`                   | Pure DoD classifiers: `classifyChecks` (soft-failure filter), `classifyReviewThreads` (P-level), `computeDodMet` |
| `packages/temporal/src/shared/pr-babysit/prompt.ts`                | `babysitIterationPrompt` (write-authority prompt) + `failureSignature` (stuck-loop guard)                        |
| `packages/temporal/src/shared/pr-babysit/loop-policy.ts`           | `decideNextAction` → done/closed/standdown/wait/act (pure, reusable by the future workflow)                      |
| `packages/temporal/src/activities/pr-babysit/exec.ts`              | `capture`/`run` (non-throwing capture for `gh pr checks` / `git merge-tree`)                                     |
| `packages/temporal/src/activities/pr-babysit/github.ts`            | `getPrSnapshot` / `getChecks` / `getReviewThreads` (gh CLI + GraphQL, honors `GH_TOKEN`)                         |
| `packages/temporal/src/activities/pr-babysit/evaluate-dod.ts`      | Deterministic gate: CI + **local merge-tree** conflicts (reuses `parseConflictPaths`) + review threads           |
| `packages/temporal/src/activities/pr-babysit/ensure-workdir.ts`    | Idempotent persistent per-PR checkout (clone-or-`reset --hard origin/<headRef>`)                                 |
| `packages/temporal/src/activities/pr-babysit/iteration-command.ts` | `claude -p` argv with WRITE tools (Edit/Write) + babysit schema                                                  |
| `packages/temporal/src/activities/pr-babysit/iteration.ts`         | `runBabysitIteration` (reuses `runTrackedAgentSubprocess`; parses cost/turns)                                    |
| `packages/temporal/src/activities/pr-babysit/push.ts`              | `pushBabysitBranch` — plain (non-force) push; non-ff → re-assess, never clobber                                  |
| `packages/temporal/scripts/run-pr-babysit-local.ts`                | Phase-0 driver: ensure workdir → loop (evaluate → act → push → wait) → report cost                               |

**Run it (Phase 0 gate):**

```bash
cd packages/temporal
CLAUDE_CODE_OAUTH_TOKEN=… bun run scripts/run-pr-babysit-local.ts --pr <#>
# --dry-run            agent runs + commits locally but never pushes
# --max-iterations 3   bound the loop while measuring
# --goal "…"           pass the PR's intent / steering
```

`gh` uses your local auth; the agent needs `CLAUDE_CODE_OAUTH_TOKEN`. The driver prints
per-iteration + cumulative `$` — those numbers set the Phase-4 budget defaults.

## Session Log — 2026-06-27

### Done

- Researched the existing infra (Temporal agent-task scheduler, `pr-bot.sjer.red` webhook, GitHub App,
  `toolkit pr health`, merge-tree conflict check) and confirmed the only real gap is mutation
  (everything is hard-locked to `report-only`).
- Wrote + approved this plan (owner-only authz, reuse the `temporal-worker[bot]` app via an
  `issue_comment` trigger, full rollout with a local PoC first).
- Implemented **Phase 0**: the 11 files above on `feature/pr-babysit-bot`.
- Verified: `bun run typecheck` (exit 0), `bun test src/shared/pr-babysit` (34 pass), `bunx eslint`
  (clean), `bun test src/workflows/bundle.test.ts` (bundle compiles — pure helpers don't leak
  activity imports).
- Added `ensure-workdir.ts` to `scripts/check-suppressions.ts` exclusions (sanctioned
  `x-access-token` askpass, same as the sibling clone helpers).

### Remaining

- **Run the Phase 0 PoC against a real failing-CI PR** (owner action; needs `CLAUDE_CODE_OAUTH_TOKEN`)
  to validate convergence + measure `$/PR`. This is the Phase 0 gate.
- _Update (2026-06-28): Phases 0–3 subsequently landed in PR #1334 (Temporal `prBabysitWorkflow` +
  `PR_BABYSIT` queue + `issue_comment` webhook ingress + authz, all dormant behind
  `PR_BABYSIT_ENABLED`). Remaining: **Phase 4** (live test against a real PR) and **Phase 5** (enable
  the kill switch) — both owner actions._
- Greptile "comments outside of diff" coverage — see `packages/docs/todos/babysit-greptile-outside-diff.md`.

### Caveats

- DoD review-thread gate currently covers **diff-anchored review threads** only. Greptile's
  "comments outside of diff" can arrive as un-anchored review/issue comments; tracked as a todo.
- Empty `gh pr checks` (no checks reported yet, e.g. right after a push) classifies as green — the
  loop mitigates with a post-push wait before re-evaluating; the future workflow waits on a CI signal.
- `@shepherdjerred/llm-models` is a `file:` dep copied into `node_modules` without its (gitignored)
  `dist`; a fresh worktree needs `bun run --filter=./packages/llm-models build` + `bun install` in
  temporal or typecheck fails to resolve it (pre-existing; surfaced here).

## Remaining

- [ ] Complete and verify the work described in `PR Babysitter Bot — GitHub-native "get this green" automation`.
