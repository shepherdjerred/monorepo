---
id: 2026-07-24-pagerduty-probe-remediation
type: plan
status: in-progress
board: false
---

# Fix the standing PagerDuty alert storm — blackbox probe remediation

## Context

13 PagerDuty incidents (#6718–#6730) fire recurringly against the Homelab service. Triage (2026-07-24, the original investigation) found **20 blackbox probes that have never succeeded** since PR #1505 auto-registered probes for every Tailnet/Cloudflare service:

- **14 probes** hit `/` with the `http_2xx` module (accepts 200/301/302) against services that legitimately return 401/403/404 at root. Backend (internal) probes cannot be pointed anywhere else: `BackendProbeDescriptor` has no `path` field and `buildTargetUrl` hardcodes `/`.
- **6 probes** target the bluemap services of the three minecraft namespaces, which are intentionally hibernated at `replicaCount: 0` (mc-router wake-on-connect, committed 2026-04-04). Probes fail whenever the servers sleep.

All services are actually healthy. Goal: every probe either passes or is suppressed while its namespace deliberately hibernates.

Owner decisions (2026-07-24): keep minecraft probes but suppress `ServiceProbeDown` while hibernated; prefer real health endpoints over `tcp_connect`, verified live before coding.

All paths below relative to `packages/homelab/src/cdk8s/`.

## Part 1 — Backend probe `path` support

- `src/misc/probe-registry.ts` — `BackendProbeDescriptor.path` (default `"/"`); `registerBackendProbe` accepts `path?`; duplicate registration with **different** module/path throws (fail fast); identical duplicate stays a no-op.
- `src/misc/tailscale.ts` — `probePath?` on `TailscaleIngress` props and `createIngress` options.
- `src/misc/cloudflare-tunnel.ts` — `probePath?` (backend side).
- `src/resources/monitoring/service-probes-chart.ts` — `buildTargetUrl` appends the path for http/https modules; `tcp_connect` ignores it.

## Part 2 — Per-service fixes (live-verified 2026-07-24 via blackbox debug endpoint)

| Service         | Call site                                                      | Fix                                                     | Live check                                           |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| loki            | `resources/argo-applications/loki.ts` createIngress :3100      | `probePath: "/ready"`                                   | 200 ✅                                               |
| tasknotes       | `resources/tasknotes/index.ts` TailscaleIngress :3000          | `probePath: "/api/health"`                              | 200 ✅                                               |
| trmnl-dashboard | `resources/trmnl-dashboard/index.ts` CF tunnel :3000           | `probePath` + `publicProbePath: "/livez"`               | 200 ✅ both                                          |
| plex            | `resources/media/plex.ts` TailscaleIngress + CF tunnel :32400  | `probePath: "/identity"` both sites + `publicProbePath` | 200 ✅ both                                          |
| birmel-oauth    | `resources/birmel/index.ts` TailscaleIngress + CF tunnel :4112 | `probePath: "/health"` both sites + `publicProbePath`   | 200 ✅ both                                          |
| seaweedfs-s3    | `resources/argo-applications/seaweedfs.ts` createIngress :8333 | `probePath: "/status"`                                  | 200 ✅                                               |
| turbo-cache     | `resources/turbo-cache.ts` TailscaleIngress :3000              | `probePath: "/v8/artifacts/status"`                     | 200 ✅ (unauthenticated)                             |
| relay           | `resources/relay/index.ts` CF tunnel :8080                     | `probePath` + `publicProbePath: "/ready"`               | 200 ✅ both                                          |
| postal-web      | `resources/mail/postal.ts` createIngress :5000                 | `probeModule: "tcp_connect"`                            | every path 403 (host-header gated)                   |
| mcp-gateway     | `resources/mcp-gateway/index.ts` TailscaleIngress :9090        | `probeModule: "tcp_connect"`                            | /health,/healthz,/status all 404 (token-gated proxy) |

No new blackbox module needed.

## Part 3 — Suppress ServiceProbeDown while minecraft hibernates

`src/resources/monitoring/monitoring/rules/service-probes.ts`:

```promql
probe_success{job=~"probe-.*"} == 0
unless on(namespace)
  (sum by(namespace) (kube_statefulset_replicas{namespace=~"minecraft-.*"}) == 0)
```

`kube_statefulset_replicas` = desired replicas (mc-router: 0 idle, 1 awake); scoped to `minecraft-.*`; existing `for: 10m` absorbs wake-up time.

## Part 4 — Tests

- `probe-registry.test.ts`: path default/override, identical-dup no-op, conflicting-dup throws.
- New `service-probes-chart.test.ts` (synth + Zod pattern from `http-probe.test.ts`): backend URL with path, tcp_connect without, public unchanged.

## Verification

1. `bun run verify -- --affected`.
2. Post-merge: blackbox debug endpoint per fixed target → `probe_success 1`; Prometheus `probe_success == 0` shows only hibernated minecraft; `ALERTS{alertname="ServiceProbeDown"}` empty.
3. Resolve PD incidents #6718–#6730; confirm no re-trigger.
