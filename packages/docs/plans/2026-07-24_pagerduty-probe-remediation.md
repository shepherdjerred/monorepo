---
id: 2026-07-24-pagerduty-probe-remediation
type: plan
status: in-progress
board: false
---

# Fix the standing PagerDuty alert storm — blackbox probe remediation

## Context

13 PagerDuty incidents (#6718–#6730) fire recurringly against the Homelab service. Triage (2026-07-24, `packages/docs/logs/2026-07-24_pagerduty-alert-triage.md`) found **20 blackbox probes that have never succeeded** since PR #1505 auto-registered probes for every Tailnet/Cloudflare service:

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

## Session Log — 2026-07-24

### Done

- Live-verified every candidate health endpoint through the blackbox exporter debug endpoint (results in the Part 2 table).
- Implemented backend probe `path` support: `probe-registry.ts` (with fail-fast on conflicting duplicate registrations), `tailscale.ts`, `cloudflare-tunnel.ts`, `service-probes-chart.ts`.
- Applied per-service fixes at all 10 call sites (Part 2 table) plus `argo-applications/argocd.ts` — the new conflict check exposed a real latent mismatch there (TailscaleIngress registered `https_2xx_insecure`, the tunnel binding silently registered `http_2xx`; now both explicit).
- Hibernation-aware `ServiceProbeDown` expr in `rules/service-probes.ts`.
- Tests: extended `probe-registry.test.ts` (path default/override, conflict throws), new `service-probes-chart.test.ts` (4 URL-building cases). Full cdk8s suite 239 pass / 0 fail; `bun run verify -- --affected` green.

### Remaining

- Merge the PR, wait for ArgoCD sync, then post-merge verification (see Verification section) and resolve PD incidents #6718–#6730.

### Caveats

- `packages/homelab/AGENTS.md` claims `bun run test` exists at `packages/homelab` — it doesn't anymore; the test script lives in `src/cdk8s` (not fixed here, noted as friction).
- postal-web 403s every path via the in-cluster service DNS name (Rails host allowlist), so its probe is TCP-only; an HTTP probe would need a Host-header-aware blackbox module.
