---
id: log-2026-07-11-afternoon-dagger-restart-loop
type: log
status: complete
board: false
---

# Dagger engine restart loop during the 2026-07-11 ~19:00 UTC storm

## Context

While investigating whether Buildkite CI concurrency (`max-in-flight`) could
safely be raised (there was real idle capacity: node at ~31% CPU / 51% mem,
Dagger engine at 3.67/16 cores peak, but a 24-job admission cap with backlog),
a live check of the Dagger engine turned up 6 container restarts over its 19h
uptime. This doc captures the investigation into those restarts, root cause,
and the fix.

## What we found

The node had a genuine but brief load storm at 19:00 UTC (`node_load1` peaked
at 13,552, back to baseline ~9 by 19:10 — ~10 minutes total), consistent with
the ZFS allocation/reclaim pathology already tracked elsewhere. That storm
knocked the Dagger engine's liveness probe (`dagger core version`, exec,
29s timeout) into continuous failure.

It was **not** an OOM: `container_memory_working_set_bytes` for the engine
plateaus at ~19.6Gi (82% of the 24Gi limit) and never approaches it before a
restart; `container_oom_events_total` was 0; `kube_pod_container_status_last_terminated_reason`
reports `Error`, not `OOMKilled`; node-wide memory was normal at every
restart timestamp.

Instead, this was a liveness-probe-triggered restart loop:

1. Liveness failed continuously from ~19:00 UTC onward (well past the point
   the node itself recovered at 19:10) — probe failure rate was effectively
   100% (`sum(rate(prober_probe_total{result="failed"}[5m]))` ≈ one failure
   per period) straight through to 21:14 UTC.
2. `failureThreshold: 60 × periodSeconds: 30s` = 30 minutes of tolerated
   failure before kubelet sends SIGTERM. Restart timestamps
   (`kube_pod_container_status_restarts_total`) landed at **19:32, 20:02,
   20:34, 21:04 UTC** — a near-exact 30-minute cadence, confirming the
   liveness threshold was the trigger every time, not a one-off crash.
3. **The actual root cause of why each restart went unclean**: the chart
   defaults the liveness probe's own `terminationGracePeriodSeconds` — a
   Kubernetes 1.25+ feature letting a specific probe override the pod-level
   grace period for kills it triggers — to **30 seconds**, completely
   independent of the pod-level `terminationGracePeriodSeconds: 300` set in
   `dagger.ts`. Verified directly against the live pod spec
   (`kubectl get pod ... -o json | jq '.spec.containers[0].livenessProbe'`)
   and against the chart source (`dagger-helm:0.21.7`,
   `templates/engine-statefulset.yaml`). 30 seconds is nowhere near enough
   time for Dagger to flush its `dagql`/BuildKit state under load, so a
   liveness-triggered kill was SIGKILLed almost immediately, regardless of
   how generous `failureThreshold` was — the 2026-07-10 tuning
   (`failureThreshold: 60`) widened the failure tolerance but did nothing
   about the kill itself being unclean.
4. An unclean shutdown makes the _next_ boot detect
   `dagql persistence store marked unclean; wiping and cold-starting` and
   wipe the on-disk BuildKit content store rather than trust it.
5. The wipe-and-rebuild is itself slow against a large existing cache and
   apparently took longer than the 30-minute liveness window on 3
   consecutive attempts, so each fresh cold start also got killed
   mid-recovery, forcing another wipe. It only broke the loop on the 4th
   attempt (21:04 restart), which happened to finish in ~15 minutes.
6. `kubelet_volume_stats_used_bytes` for the engine's PVC confirms the wipe
   was real and total, not just a small metadata file: usage fell from
   **1214 Gi (19:25 UTC) to 16.5 Gi (21:15 UTC)**, staircasing down across
   the four restart cycles, then climbed back (232 Gi by 21:45, 353 Gi by
   23:12) as new builds repopulated it. `/var/lib/dagger/worker/` (the
   BuildKit content-addressable store) had `mtime` matching the last
   restart exactly, while the separate `cache.db` (81MB, untouched since
   Jul 10) confirmed only the worker/content store gets wiped, not
   everything under `/var/lib/dagger`.

Net effect: a 10-minute node-level storm turned into ~2h15m of Dagger engine
unavailability (19:00–21:17 UTC) plus a fully-evicted 1.2Ti build cache, with
degraded build times for hours afterward while the cache rewarmed.

Contrast with the two earlier same-day storms (03:38 and 06:08 UTC): each
caused exactly **one** restart with a clean recovery, no spiral. The
difference is almost certainly how much cache had accumulated by each point
in the day — a bigger `worker/` store takes longer to reconcile on cold
start, making it more likely to blow past the 30-minute liveness window.
This also means the risk scales with CI throughput: raising Buildkite
concurrency (`max-in-flight`) increases steady-state cache churn, which is
exactly the variable that made the difference here.

## Fix

`packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`,
`engine.livenessProbeSettings`:

- `terminationGracePeriodSeconds: 30 -> 280` (just under the pod-level
  300s) — gives the engine a real chance to shut down cleanly when
  liveness fires, which should make the wipe-and-loop path the exception
  rather than the rule.
- `failureThreshold: 60 -> 240` (30 min -> 2h) — defense in depth for the
  case a wipe still happens: the 2026-07-11 storm needed up to ~90 minutes
  of cold-start-after-wipe before probes passed again, which 30 minutes
  does not cover.

A true `startupProbe`/`livenessProbe` split (generous budget for cold start,
tight budget for steady-state hang detection) was considered but isn't
achievable through this chart's values — `dagger-helm:0.21.7`'s
`engine-statefulset.yaml` only templates `readinessProbeSettings` and
`livenessProbeSettings` into the pod spec; there's no `startupProbe` block
rendered at all. Achieving a real split would require a Kustomize
post-renderer patch on top of the Helm output, a bigger structural change to
how this ArgoCD Application is wired, and was judged not worth it relative
to the two value changes above, which target the same failure mode directly.

Verified: `bun run typecheck`, `bun run test` (both green in
`packages/homelab`), `bunx eslint . --fix` (clean), and a direct
`helm template` render confirming both values land correctly on the
StatefulSet's `livenessProbe`.

## Buildkite concurrency question (original ask)

Separately from the restart-loop investigation: node and Dagger engine both
had real idle headroom (node ~31% CPU / 51% mem; engine 3.67/16 cores peak
over 6h) against a 24-job Buildkite `max-in-flight` cap with a 30-job Kueue
backlog. Raising the cap (e.g. 24 -> 28) remains a reasonable follow-up once
this restart-loop fix has been observed through at least one more storm — no
code change made yet, left as a follow-up decision.

## Session Log — 2026-07-11

### Done

- Diagnosed the Dagger engine restart-loop root cause: liveness probe's own
  30s `terminationGracePeriodSeconds` (independent of the pod-level 300s)
  made every liveness-triggered restart unclean, forcing a full buildcache
  PVC wipe (confirmed via `kubelet_volume_stats_used_bytes`: 1.2Ti -> 16.5Gi)
  and a compounding restart loop (19:32/20:02/20:34/21:04 UTC) until cold
  start finally finished inside the 30-minute liveness budget.
- Fixed in `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`:
  `livenessProbeSettings.terminationGracePeriodSeconds: 30 -> 280`,
  `failureThreshold: 60 -> 240`. Verified via `helm template` that both
  values land correctly on the rendered StatefulSet's `livenessProbe`.
- `bun run typecheck`, `bun run test`, `bunx eslint . --fix` all green in
  `packages/homelab`.
- Worktree: `.claude/worktrees/dagger-startup-probe`, branch
  `fix/dagger-startup-probe`.

### Remaining

- PR not yet opened — change is committed locally in the worktree branch,
  pending user go-ahead to push/open PR.
- After this deploys via ArgoCD, watch the next storm's Dagger engine
  behavior to confirm the fix actually prevents the unclean-shutdown wipe
  (i.e. a liveness-triggered restart completes within its 280s grace and
  the buildcache PVC does _not_ collapse toward zero).
- Buildkite `max-in-flight` 24 -> 28 bump (the original ask) is still an
  open, separate decision — deferred pending observation of this fix.

### Caveats

- A true `startupProbe`/`livenessProbe` split was the original proposal but
  is not supported by `dagger-helm:0.21.7`'s chart templates; the two
  liveness-probe value changes above are the closest achievable equivalent
  without restructuring the ArgoCD Application to use a Kustomize
  post-renderer.
- The 280s grace period is a judgment call (just under the pod's 300s) —
  if Dagger's own shutdown sequence genuinely needs longer under a very
  large cache, the pod-level `terminationGracePeriodSeconds` may also need
  raising in a follow-up.
