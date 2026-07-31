---
id: ci-io-post-merge-impact-bwrap-sandbox
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-30_homelab-audit-agent-task-schema-fix.md
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

Commit `cda4e819e` ("feature/codex-sandbox-danger-full-access", landed
2026-07-30) already switches `codexCommand`'s `--sandbox` flag from
`read-only` to `danger-full-access` to fix this. It was **not yet verified
against a real scheduled run** as of this writing — the next
`ci-io-post-merge-impact` firing (cron `0 9 * * *` PT) is the first real test.

## Remaining

- [ ] After `cda4e819e` has had at least one real scheduled run, inspect it via
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
