# Bugsink check-in: Temporal alert-remediation `claude -p` hang

## Status

Complete (investigation only — no code changed)

## Ask

User: "Check in on my bugsink issues for temporal." Then challenged the
premise: "there is no way we are actually running claude code or any AI
workload for 30m."

## Bugsink state (project `temporal`, id 12)

- 230 open (unresolved, unmuted) issues, which collapse to **3 distinct problems**:
  1. **`Error: alert-remediation agent exited with code 143 (SIGTERM, durationMs≈1.83M)`**
     — 228 issues, 489 events, first_seen 2026-06-15, last_seen ongoing (today).
     Bugsink can't dedupe them because `durationMs` is in the message, so each
     run is its own "issue."
  2. `Error: claude agent task cancelled` — 1 issue, 30 events, 05-25→06-19.
  3. `Error: Command failed (git): exit …` (ANSI-laden) — 1 issue, 2 events, 06-15.
- The 250 the toolkit/API returns by default (digest*order asc) are all
  \_resolved* historical issues — the open ones only surface sorting
  `last_seen desc` and paginating.

## The one real problem: every `claude -p` CLI run hangs to its timeout

User's intuition is **correct** — it is not 30 min of AI work. Evidence:

- **Loki heartbeat trace of one run** (`alert-remediation/pagerduty/...`):
  `idleMs == elapsedMs` on every 10 s beat from +0 s to +1834 s. `idleMs` =
  "ms since last stderr byte," so equality the whole way ⇒ the `claude`
  subprocess emitted **zero stdout + zero stderr** from spawn to kill.
  - +1710 s soft-kill SIGINT fires (T−90 s) — `claude` **ignores it**.
  - +1834 s `exitCode=143 signal=SIGTERM` — Temporal's hard cancel kills it.
- `durationMs` is pinned at the 30-min activity `startToCloseTimeout`
  (median 1,834,247 ms ≈ 30.6 min) across all 228, spanning many _different_
  alerts (pagerduty + bugsink fingerprints). Real bounded work (opus,
  maxTurns=15) would finish in minutes and vary — not peg the wall every time.
- **24h Prometheus:** 108 subprocess exits, **100% `signal=SIGTERM` (143)**,
  zero natural exits. `alert_remediation_decisions_total` = 108 failed
  (63 pagerduty + 45 bugsink), **0 succeeded**. 83 soft-kills.
- **Both `claude -p` CLI activities hang**, not just alert-remediation:
  `runAgentTask` (homelab-audit, daily) shows `exit_code=cancelled` too.
  → fault is the **`claude` CLI in the worker pod**, not the prompt/model/alert.

## Why all 228 "appeared" 06-15 (not a new regression that day)

This hang was **already known on 2026-06-14**. PR #1230
(`feat(temporal): agent-subprocess observability + schedule tuning`, merged
06-14 16:40 PT) was built _to instrument it_, per
`packages/docs/plans/2026-06-14_temporal-agent-observability.md`:

- Plan issue #3: "30-min activity wall-clock exits, zero stderr, 30/30 recent
  children `decision: failed, reason: Activity task timed out`. We discovered
  this 14 days late." Root cause recorded as **Unknown** ("`claude -p
--output-format json` is normally silent on stderr — 'no stderr' doesn't
  prove hang vs work").
- #1230 added the `captureWithContext` Sentry call on the non-zero-exit path
  (`alert-remediation.ts:355`). **That** is why Bugsink lit up 06-15 — error
  reporting went live, not the hang. The hang predates it.
- #1230's hypothesis — WebFetch is the hang vector, so drop it — is
  **disproven**: WebFetch was removed 06-14 and 100% of runs still hang today.

## Leading root-cause hypothesis (unconfirmed)

`claude` (claude-code, pinned `CLAUDE_CODE_VERSION = 2.1.143` in
`.dagger/src/constants.ts`; bumped 06-14) makes a **blocking call at startup
before any work/output** that never returns in the locked-down worker pod —
candidates: auth/verify, update-check, telemetry, or config/cache write.
SDK-based `runPrSummaryPipeline` (same egress + `ANTHROPIC_API_KEY`) is the
contrast to test. Timing also coincides with deny-by-default tailnet ACL
(#1045) + node lockdown landing ~06-13/06-14.

**Definitive repro (next step):** exec the worker pod and run the exact
command with a timeout + debug:

```bash
kubectl exec -n temporal deploy/temporal-temporal-worker -- \
  sh -c 'timeout 120 claude -p "say hi" --output-format json \
  --model claude-opus-4-8 --dangerously-skip-permissions --debug --verbose; echo EXIT=$?'
```

If it hangs with no output, it's the CLI/startup. Compare against the SDK path
and against `claude --version` succeeding (the image build runs that, so the
binary itself starts).

## Secondary findings (real gaps)

- **Soft-kill SIGINT is ineffective.** `claude -p` ignores SIGINT
  (`agent-subprocess.ts:261`); runs always reach the hard SIGTERM. The "let
  Claude flush before SIGTERM" design doesn't hold for this CLI.
- **The page that should catch this isn't firing.**
  `AlertRemediationDecisionsAllFailing` (>50% failed for 2h → page) is **absent
  from `ALERTS{}` in any state**, while the computed ratio
  `failed/total rate[1h]` = **1.0** for days. Only the info-level
  `AgentSubprocessSoftKill` ticket fires. Rule likely not deployed or its
  expr/labels don't match the emitted series — verify in
  `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`.
- **`maxIdleMs` is a blind detector here.** It only updates on a stderr line
  (`bumpStderrState`), so a zero-stderr hang reports `maxIdleMs=0` (looks
  healthy). The live `idleMs` heartbeat (now − lastStderrAt) is the real
  signal; consider emitting `maxIdleMs = elapsedMs` when no stderr ever arrives,
  or watch stdout too.
- **Blast radius:** `alert-remediation-hourly` fans out every hour at
  concurrency=3; ~50 hung 30-min opus subprocesses/day, remediating nothing,
  alerts never clear so the same fingerprints recur next hour. Consider
  pausing the schedule until the CLI hang is fixed (the plan said "no schedule
  pausing," but that predated the 100%-failure-for-days data).

## Session Log — 2026-06-19

### Done

- Triaged all open Bugsink `temporal` issues → 1 real problem (228 dupes) + 2 singletons.
- Proved (Loki idleMs trace + 24h Prom metrics) the alert-remediation agent
  hangs producing zero output and is hard-killed at the 30-min timeout; 100%
  failure, zero successes. Confirmed the same for the homelab-audit `claude -p`.
- Traced the 06-15 onset to #1230's Sentry-capture going live (instrumentation,
  not a new regression) and disproved the WebFetch-hang hypothesis.
- Found two gaps: ineffective SIGINT soft-kill, and the
  `AlertRemediationDecisionsAllFailing` page not firing despite ratio=1.0.

### Remaining

- Run the in-pod `claude -p` repro to pin the startup hang (CLI vs egress/auth).
- Fix forward: depends on repro — likely pin/patch claude-code, or migrate the
  two CLI activities to the Anthropic SDK (already the plan's out-of-scope
  follow-up), and/or fix egress allowlist.
- Fix the non-firing page + the SIGINT/`maxIdleMs` observability gaps.
- Once fixed: bulk-resolve the 228 Bugsink dupes (web-UI bulk action — REST API
  is read-only, see `reference_bugsink_resolve_via_ui`).

### Caveats

- Root cause is a hypothesis, not yet confirmed — no repro run this session.
- No code or schedules changed; investigation only.
- Bugsink API returns raw control chars in some strings → `jq` chokes; parse
  with Python `json.loads(strict=False)`. urllib gets 403 (WAF/UA) — drive
  `curl` from Python instead.
