---
id: 2026-07-24-pagerduty-alert-triage
type: log
status: complete
board: false
---

# PagerDuty Alert Triage — 2026-07-24

Investigated the 13 triggered PagerDuty incidents (#6718–#6730, all "Homelab" service,
created 4:07–4:41 PM PT). All are blackbox-exporter `ServiceProbeDown` /
"internal probe is down" alerts.

## Findings

**Nothing newly broke today.** The underlying probes have been failing for at least
14 days (Prometheus `probe_success` history shows zero successes over the full
retention window sampled). Today's incidents are re-triggers of a standing alert
condition, not a new outage.

Cluster itself is healthy: node `torvalds` Ready, all alerting services' pods
Running (only Buildkite CI job pods were in Error, which is unrelated).

20 probes are failing, in two distinct classes:

### Class 1 — Probe misconfiguration (services are actually UP), 14 probes

The auto-registered probes from PR #1505 hit `/` with the `http_2xx` module
(valid codes 200/301/302). `registerBackendProbe` in
`packages/homelab/src/cdk8s/src/misc/probe-registry.ts` has **no `path` option
at all**; `registerPublicProbe` has one but every call site defaults to `/`.
These services can never pass at `/`:

| Target                                                | Response at `/` | Why                             |
| ----------------------------------------------------- | --------------- | ------------------------------- |
| loki :3100 (internal)                                 | 404             | health endpoint is `/ready`     |
| mcp-gateway :9090 (internal)                          | 404             | metrics port; no route at `/`   |
| turbo-cache :3000 (internal)                          | 404             | no route at `/`                 |
| relay :8080 (internal) + relay.sjer.red               | 404             | no route at `/`                 |
| birmel-oauth :4112 (internal) + birmel-oauth.sjer.red | 404             | no route at `/`                 |
| tasknotes :3000 (internal)                            | 401             | auth-gated                      |
| trmnl-dashboard :3000 (internal) + trmnl.sjer.red     | 401             | auth-gated                      |
| plex :32400 (internal) + plex.sjer.red                | 401             | auth-gated                      |
| seaweedfs-s3 :8333 (internal)                         | 403             | anonymous S3 root is always 403 |
| postal-web :5000 (internal)                           | 403             | auth/CSRF-gated                 |

### Class 2 — Services genuinely absent, 6 probes

All three minecraft namespaces (`minecraft-sjerred`, `minecraft-tsmc`,
`minecraft-shuxin`) contain **zero pods** — bluemap internal probes get
connection errors and the public bluemap hostnames return 502/timeout.
Whether this is intentional (servers spun down) needs Jerred's confirmation.

## Suggested fix direction (not yet implemented)

- Add a `path` (and possibly per-probe `module`, e.g. accepting 401/403 for
  auth-gated apps) to `registerBackendProbe` and thread it through the
  auto-registration call sites (`TailscaleIngress`, `createIngress`,
  `createCloudflareTunnelBinding`), pointing each service at a real health
  endpoint (`/ready` for Loki, `/identity` for Plex, etc.).
- Alternatively accept 401/403 in a dedicated module for auth-gated services
  (still proves the service is answering).
- Decide whether minecraft/bluemap probes should be deregistered while the
  servers are down, or the servers brought back.

## Session Log — 2026-07-24

### Done

- Triaged all 13 PD incidents via `toolkit pd incidents`; confirmed all map to
  20 failing blackbox probes.
- Verified cluster/node/pod health; queried Prometheus + blackbox exporter
  debug endpoint for every failing target; classified each failure.
- Root-caused: probe registry probes `/` with strict 2xx expectations
  (`probe-registry.ts`), which 14 healthy services can never satisfy; the
  6 remaining failures are the empty minecraft namespaces.

### Remaining

- ~~Implement probe path/module fixes in `packages/homelab`~~ — done same day;
  see `packages/docs/plans/2026-07-24_pagerduty-probe-remediation.md`.
- ~~Confirm whether minecraft servers are intentionally down~~ — confirmed
  intentional (replicaCount 0 hibernation, mc-router wake-on-connect); alert
  now suppressed while hibernated instead of deregistering the probes.
- The 13 PD incidents are still triggered — resolve them once the fix PR
  merges and probes go green.

### Caveats

- Probes have never succeeded since rollout (PR #1505); PR #1561's alert-storm
  remediation did not address the wrong-path/status-code issue.
- Buildkite job pods in `buildkite` ns were erroring during the session —
  unrelated to these alerts, not investigated.
