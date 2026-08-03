---
id: ci-io-post-merge-impact-bwrap-sandbox
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-30_homelab-audit-agent-task-schema-fix.md
---

# Verify `ci-io-post-merge-impact` codex sandbox fix in production

Discovered while root-causing the unrelated `homelab-audit-daily` schema
regression (2026-07-30): the other declared agent-task schedule,
`ci-io-post-merge-impact` (provider `codex`), has been failing every run
since at least 2026-07-21 with:

```
bwrap: No permissions to create a new namespace
```

Every shell command the codex agent tries fails before execution — `codex
exec`'s `--sandbox read-only` uses bubblewrap, which needs a Linux namespace
the (unprivileged, non-root) worker pod can't create. On 2026-07-29 this also
manifested as an OpenAI quota 429; on 2026-07-30 the run technically completed
(`WORKFLOW_EXECUTION_STATUS_COMPLETED`) but the report itself says "Blocked by
the report runner environment; no acceptance conclusion is possible" — every
command still failed with the same `bwrap` error, so the "success" is
illusory.

The fix landed through PR #1860. Commit `cda4e819e`
("fix(temporal): stop nesting a bwrap sandbox inside the worker pod") switches both
`codex exec` call sites in `packages/temporal/src/activities/agent-task-command.ts`
from `--sandbox read-only` to `--sandbox danger-full-access`. The current
Temporal worker `2.0.0-7749` contains the merge. The August 2 scheduled run
`019fc334-1c27-7bc8-add0-c1142fbda866` completed before that deployment and is
therefore not an acceptance test of the fix.

## Remaining

- [x] Merge PR #1860 and deploy a Temporal worker containing the `danger-full-access` fix.
- [ ] After the deployed fix has had at least one real scheduled run,
      inspect it via
      `temporal workflow list --query "WorkflowId STARTS_WITH 'ci-io-post-merge-impact'"`
      (`TEMPORAL_ADDRESS=temporal.tailnet-1a49.ts.net:443 --tls`) and confirm
      the report no longer contains the `bwrap` error and reaches a real
      acceptance conclusion (not "Blocked by the report runner environment").
- [ ] If `danger-full-access` didn't fix it, investigate whether the worker
      pod's seccomp/capabilities profile (not just the codex CLI flag) needs
      changing — see `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`.

## Comment Log

### 2026-07-30 — filed during homelab-audit-daily root cause investigation

- Found while comparing `ci-io-post-merge-impact` (codex) against
  `homelab-audit-daily` (claude) in the live Temporal cluster to isolate the
  Claude-specific schema-dialect bug. This bwrap issue is unrelated to that
  fix and is not addressed by it.

## Session Log — 2026-08-02

### Done

- Confirmed PR #1860 merged and the current healthy Temporal worker includes it.
- Confirmed the latest scheduled run predates that deployment, so it cannot accept or reject the fix.

### Remaining

- Inspect the first post-deploy scheduled run for a real acceptance conclusion without the bubblewrap error.

### Caveats

- The card remains active, not blocked; time is the only prerequisite for the next scheduled observation.
