---
id: log-2026-07-12-scrypted-cpu-throttle-doorbell-offline
type: log
status: complete
board: false
---

# Scrypted CPU Throttle — Reolink Doorbell Offline in HomeKit

## Context

User reported the Reolink front-door doorbell showing offline in Apple HomeKit, then
separately noted `https://scrypted.tailnet-1a49.ts.net/` was unreachable. The doorbell is
bridged into HomeKit exclusively via Scrypted's HomeKit Secure Video plugin (per
`packages/docs/todos/homekit-secure-video.md` — HA's own HomeKit bridge for this camera
was deliberately retired in PR #1321).

## Findings

- Live `kubectl top` showed `home-scrypted-*` pinned at ~92-100% of its 1-core (1000m)
  CPU limit, sampled repeatedly.
- `kubectl logs` showed Scrypted's internal watchdog failing: `Scrypted Core plugin is
not responding to ping. restarting`, `plugin worker did not exit in 5 seconds`, and
  RPC-killed errors specifically for `host:@scrypted/homekit`.
- `kubectl describe pod` showed a `Killing ... failed liveness probe` event recurring
  ~552 times over 23h, plus a real `OOMKilled` two days prior at the old 2Gi memory
  limit.
- Confirmed via direct port-forward to the pod's HTTP port (11080) that the process
  itself wasn't responding (timeout, status `000`) — the Tailscale ingress sidecar was
  healthy, ruling out a Tailscale-layer problem.
- A full cluster-wide pod sweep (`kubectl get pods -A`, restart counts, `kubectl top
pods -A --sort-by=cpu`) confirmed **Scrypted was the only pod currently pinned at its
  resource limit** (995m/1000m CPU). One other pod (`dagger-dagger-helm-engine-0`) was
  elevated at 80% of its memory limit but not in a comparable crisis state.

### Separate finding: node-wide mass-OOM event (not fixed here)

While auditing all pods, found that **121 containers across ~40 namespaces** were
OOMKilled/Errored within the same 1-2 second window at `2026-07-11T06:07:15Z`
(`2026-07-10 23:07 PDT`) — essentially every workload on `torvalds` simultaneously
(ArgoCD, 1Password Connect, cert-manager, both CoreDNS replicas, the full Loki stack,
every Tailscale ingress sidecar, Prometheus, Postal, Plausible, Temporal, media stack,
etc.). This is the signature of a genuine node-wide kernel OOM sweep, not isolated
per-app leaks.

Root cause candidate: the node has ~73.4 GiB allocatable memory, but the **sum of every
pod's configured memory limit across the cluster is ~151 GiB — roughly 2x overcommitted**.
Individual limits look fine in isolation; there's no cluster-wide ceiling stopping many
pods' real usage from summing past physical RAM at once.

There's also separate evidence the node/kubelet restarted around the same period:
`NetworkUnavailable` cleared ~2026-07-10 18:11 PDT, and the node `Ready` condition
re-transitioned ~2026-07-11 12:00 PDT (with `kube-scheduler`/`kube-controller-manager`
restarting at that same second point).

**This was NOT addressed in this session/PR** — it's a separate, already-recovered
incident (everything self-healed except Scrypted, which was still actively
CPU-throttled for unrelated reasons — see above). A dormant worktree/branch
`feature/torvalds-memory-rightsize` already exists from a prior session (created
2026-07-11, branched off `752b840bf`) with zero commits — it looks like this exact
follow-up (cluster memory rightsizing/overcommit audit) was intended but never started.
A future session should pick that up rather than starting fresh, or confirm with the
user whether to reuse or discard it.

## Fix

PR #1500 (`fix/scrypted-cpu-limit`): raised Scrypted's resource limits in
`packages/homelab/src/cdk8s/src/resources/home/scrypted.ts`:

- CPU: request `100m -> 500m`, limit `1000m -> 2000m`
- Memory: limit `2Gi -> 4Gi` (request unchanged at 512Mi)

Node has ample spare CPU (27 allocatable cores, nothing else CPU-bound), so raising the
ceiling is safe and doesn't need the broader overcommit audit to land first.

## Session Log — 2026-07-12

### Done

- Diagnosed the doorbell-offline + unreachable-console reports down to Scrypted's live
  CPU throttling (confirmed via `kubectl top`, `kubectl logs`, `kubectl describe pod`,
  and a direct port-forward test).
- Audited all pods on `torvalds` for the same under-provisioning pattern; confirmed
  Scrypted was uniquely affected right now.
- Surfaced (but did not fix) a separate, already-resolved node-wide mass-OOM event from
  2026-07-10/11 affecting 121 containers, and a 2x memory-limit overcommit
  (151 GiB limits vs. 73.4 GiB allocatable) that's the likely root cause if it recurs.
- Opened PR #1500 raising Scrypted's CPU/memory limits; typecheck, full homelab test
  suite (171 + 252 tests), eslint, and full pre-commit (tier-1 + tier-2, incl. helm
  lint, 1Password lint, quality ratchet) all pass. Rendered `dist/home.k8s.yaml`
  confirms the new limits took effect.

### Remaining

- Merge PR #1500, let ArgoCD sync, then confirm live: Scrypted's CPU usage drops well
  below the new 2000m limit, the liveness-probe kill loop stops, the doorbell reappears
  as responsive in Apple Home, and `https://scrypted.tailnet-1a49.ts.net/` loads.
- Decide whether to resume `feature/torvalds-memory-rightsize` (dormant, zero commits)
  for the cluster-wide memory-overcommit audit, or discard it and file a fresh todo.
- HomeKit pairing itself (`packages/docs/todos/homekit-secure-video.md`) was last
  updated 2026-06-27 and still shows `status: blocked` on needing an Apple device on
  the Seattle LAN — worth confirming with the user whether that step was ever
  completed, since it changes what "doorbell offline" actually means (a real
  regression on a working pairing vs. a still-unpaired/stale accessory tile).

### Caveats

- The exact mechanism behind kubelet reporting ~552 aggregated "Killing" events over 23h
  while the container's own restart count only shows 2 was not fully reconciled — likely
  event-aggregation/dedup behavior in `kubectl get events`, not 552 actual container
  restarts. Doesn't change the diagnosis (CPU throttling is independently confirmed via
  live `kubectl top` + logs + port-forward).
- Did not confirm via Talos kernel dmesg that the Jul 10/11 event was a true global OOM
  (the ring buffer had already rotated past it by the time this was checked, likely due
  to the later node/kubelet restart clearing it). The container-status timestamp
  correlation (121 containers, same 1-2s window) is strong circumstantial evidence but
  not a kernel-log-confirmed root cause.
