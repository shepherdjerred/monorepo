# Temporal failures — last 72h root-cause analysis + remediation

## Status

In Progress — diagnosis complete & verified live; fixes implemented on `fix/temporal-failures`.
golink ACL grant applies via CI `tofu-apply-all` on merge. Awaiting merge + post-deploy verification.

## Context

"Look into why my Temporal failures in the last 72 hours failed." Queried the live Temporal server
(`temporal-temporal-server-service.temporal.svc.cluster.local:7233`, namespace `default`, via the
server pod on `admin@torvalds`) for all non-Completed executions 2026-06-17 → 2026-06-20, then traced
each distinct failure to root cause via worker logs, source, git history, and live connectivity tests.
**Three independent causes** — one already fixed, two fixed here.

## Live failure inventory (06-17 → 06-20)

| Workflow                                                        | Outcome                                   | Status                         | Cause |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------ | ----- |
| `homelab-audit-daily` (`agentTaskWorkflow`)                     | Failed 06-14→06-19                        | ✅ Recovered (06-20 13:30)     | 1     |
| `alert-remediation-hourly` (sweep) + bugsink/pagerduty children | TimedOut/Terminated hourly to 06-20T01:00 | ✅ Recovered (throttled daily) | 1     |
| `golink-sync` (`syncGolinks`)                                   | TimedOut every day since 06-14            | 🔧 Fixed here                  | 2     |
| `scout-data-dragon-weekly-refresh`                              | Failed 06-20 (weekly)                     | 🔧 Fixed here + re-trigger     | 3     |

## Cause 1 — `claude -p` file-path hang ✅ (already fixed, no action)

`claude -p --json-schema <path>` wedged on startup (needs inline JSON); result read from `.result`
not `.structured_output`. Fixed by PR #1264 + #1279 (throttle hourly→daily). Live-confirmed recovered.
"Terminated" children = cascade kills from timed-out parents.

## Cause 2 — golink-sync blocked by deny-by-default Tailscale ACL 🔧

- `getExistingGolinks` fetch to `https://go.tailnet-1a49.ts.net/.export` → `ConnectionRefused` after a
  ~133s hang (`durationMs:133553`). golink itself healthy (HTTP 200 from an admin device).
- **Trigger:** PR #1045 deny-by-default Tailscale ACL, applied 2026-06-13 16:06 PT — between golink's
  last success (06-13 05:00 PT) and first failure (06-14 05:00 PT).
- **Why golink only:** golink runs its own embedded tsnet node tagged `tag:k8s-operator`
  (`packages/homelab/src/cdk8s/src/resources/golink.ts:55`); other services use `tag:k8s` ingress
  proxies. ACL granted `tag:k8s → tag:k8s:443` but not `tag:k8s → tag:k8s-operator:443`. Live test:
  worker → chartmuseum/seaweedfs (`tag:k8s`) OK, → golink (`tag:k8s-operator`) TimeoutError.
- **Secondary:** golink activity fetches had no `AbortSignal`, so each attempt hung ~133s and overran
  the 4-min workflow timeout, masking the real error as a generic `TimedOut`.

**Fix (this branch):**

- `packages/homelab/src/tofu/tailscale/acl.tf` — add `tag:k8s → tag:k8s-operator:443` accept rule +
  test. Applied by CI `tofu-apply-all` (the `tailscale` stack) on merge; PR gets a `tofu-plan-all`
  preview and Tailscale validates the `tests` block on apply.
- `packages/temporal/src/activities/golink-sync.ts` — `AbortSignal.timeout(20_000)` on all 4 fetches.

## Cause 3 — scout-data-dragon transient new-patch CDN lag 🔧

- 06-20 weekly run threw: Renata 31 & Zed 69 loading screens missing from BOTH CDNs on fresh patch
  16.12.1 (`update-data-dragon.ts` hard-throws on any both-sources miss). Self-healed — both assets
  returned HTTP 200 hours later. The script had **zero retry logic** across all 9 fetch sites, and
  `fetchCDragonChampion` cached `undefined` on any failure (poisoning the whole champion's fallback).

**Fix (this branch)** — `packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts`:

- `fetchWithRetry` helper (retry network/5xx with exponential backoff; 4xx returned as-is) on all core
  fetches + image downloads + both loading-screen tiers.
- `fetchCDragonChampion` no longer caches transient failures (only definitive 404/parse misses).
- `retryFailedLoadingScreens`: after the first pass, re-attempt only the both-sources-failed skins
  (clearing their CDragon cache) up to 3 rounds × 30s before the existing hard throw. Preserves the
  loud hard-fail for genuinely-missing assets; activity heartbeats every 10s so the sleeps are safe.
- Operational: re-trigger `runScoutDataDragonWeeklyRefresh` now (assets exist → Completes).

## Verification

- Local: `bun run typecheck` (temporal + data) clean; `golink-sync.test.ts` + `update-data-dragon.test.ts`
  pass; `tofu fmt -check` clean.
- Post-merge: ACL applies → from worker pod `fetch(go.tailnet/.export)` → HTTP 200 → trigger
  `golink-sync` → Completed. Re-trigger data-dragon → Completed. 24–48h: no new TimedOut/Failed for
  golink-sync / agent-task / alert-remediation.
