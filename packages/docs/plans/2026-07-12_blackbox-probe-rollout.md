# Blackbox Probe Coverage — Scrypted + Full Tailnet/CF-Tunnel Rollout

## Status

Complete (shipped in PR #1505; post-merge/ArgoCD-sync live verification is a follow-up)

## Context

The Scrypted CPU-throttle incident (fixed in PR #1500) exposed a real observability gap: when we checked, **none** of the 37 services exposed via `TailscaleIngress` had any uptime/health probe, and neither did the Cloudflare-Tunnel-fronted apps. Even a basic "is this URL responding" check would have caught the doorbell/console outage. The user asked to close this gap — add a blackbox probe to Scrypted, and extend the same coverage to every other Tailnet- and Cloudflare-Tunnel-backed service, not just Scrypted.

Research (3 Explore agents + 1 Plan agent, all against the live tree) confirmed:

- One existing probe pattern already lives in `misc/s3-static-site.ts`, built on the Prometheus Operator `Probe` CRD — generalizable, not reusable as-is.
- **0 of 38** `TailscaleIngress`-backed services have a probe today.
- Cross-referencing Cloudflare Tunnel bindings turns up **21 services** with a public CF hostname, **16 of which overlap** with the Tailscale list (e.g. Scrypted-style apps that are reachable both ways) and **5 of which are CF-only** (3 Temporal webhook endpoints, `relay`, `trmnl-dashboard` — no `TailscaleIngress` at all). Computed precisely via set operations (script, not hand-counted): **43 distinct services total**.
- User explicitly wants both paths tracked independently for the overlap set: "if something is on both tailnet and CF we want to know of both problems." So every service gets an **in-cluster backend probe** (catches app-level failures, the thing that actually broke in the Scrypted incident), and every one of the 21 CF-tunnel-fronted services _additionally_ gets a **public-hostname probe** (catches edge/tunnel/DNS-layer failures the backend probe can't see) — mirroring how `s3-static-site.ts` already probes real public hostnames over the internet.
- The one alert rule that conceptually overlaps (`CPUThrottlingHigh`) is irrelevant here — this is a new, generic "is the probe succeeding" rule, following the `static-sites.ts` alert pattern but with its own job-prefix so it doesn't collide, and a `path` label (`internal`/`public`) so the two failure modes are distinguishable in the same alert.
- PagerDuty only pages on `severity: critical|warning` (confirmed against `pagerduty-alerting.test.ts` and the Alertmanager route) — the new alert must use one of those, not `info`.
- 13 of the ~30 involved namespaces have a `NetworkPolicy` that would currently block in-cluster _backend_ probe traffic from the `prometheus` namespace and need a one-line ingress-rule addition; the rest are already unrestricted or already allow it (confirmed for `home`/`media`). This only affects backend probes — public-hostname probes are a normal outbound internet request from the blackbox-exporter pod and need no NetworkPolicy change, same as static-site probing today.
- Only one target (`temporal-server`, port 7233) is non-HTTP (gRPC) and needs a new `tcp_connect` blackbox module. `argocd-server` is HTTPS-only in-cluster and needs a TLS-skip-verify module variant for its backend probe (its public probe over the CF tunnel gets a normal, validly-certed HTTPS endpoint, so `http_2xx` is fine there). The 3 Temporal webhook services are POST-only receivers, so their backend probes get `tcp_connect` too rather than risking false "down" alerts on a GET `/`; their public CF-hostname probes use the same `tcp_connect` treatment for consistency, since they're POST-only regardless of path.

## Approach

**Key design shift from the first draft**: rather than a manual second `createHttpProbe(...)` call at all 43+21 sites (which a future 44th service could easily add without remembering to add its probe), probe creation is **automatic** — built into `TailscaleIngress` and `createCloudflareTunnelBinding` themselves via a self-registering descriptor pattern, with one finalization pass that emits the actual `Probe` resources after every chart has run. Confirmed feasible by a targeted follow-up Explore pass: `TailscaleIngress` is a `Construct` class but doesn't store `host`/`service`/`port` on `this` (so a post-hoc construct-tree scan isn't viable — those properties are lost after construction), and `createCloudflareTunnelBinding` is a plain function instantiating a `TunnelBinding` CRD, also with no natural traversal hook. A shared in-memory registry populated at construction time is the clean fit, and it was confirmed all 11+ overlap call sites (freshrss, home-assistant, bugsink, etc.) already pass the _identical_ `Service` construct/name to both calls, so dedup-by-identity is reliable.

### 1. Shared infrastructure (new/modified files)

- **`packages/homelab/src/cdk8s/src/misc/probe-registry.ts`** (new) — a module-level registry (`Map` + array; safe because `app.ts` runs the whole synth in one process, so every chart file's import of this module shares the same instances before finalization runs). Exports:
  - `registerBackendProbe({ namespace, serviceName, port, module? })` — dedupes on `${namespace}/${serviceName}:${port}`; a second registration for the same key (e.g. from `createCloudflareTunnelBinding` firing after `TailscaleIngress` already registered the same service) is a silent no-op, not an error.
  - `registerPublicProbe({ namespace, fqdn, module? })` — always registers (public targets are 1:1 with CF tunnel bindings, never duplicated).
  - `resetProbeRegistry()` — clears both registries. Not needed by the real synth (a single `app.ts` run never needs to reset), but required so `setupCharts()` starts clean on every independent call — the test suite's ~28 files each construct their own `App` and call `setupCharts()` within the same bun:test process, and without a reset the registry leaked across test files, causing `createServiceProbesChart` to try to create duplicate-named `Probe` constructs. Found and fixed during verification (see Caveats).
- **`TailscaleIngress`** (`packages/homelab/src/cdk8s/src/misc/tailscale.ts`, edit) — after building the `Ingress`, calls `registerBackendProbe(...)`. Two new optional props: `probeModule?: ProbeModule` and `disableProbe?: boolean`. `createIngress` (the plain-function sibling used by argocd/chartmuseum/seaweedfs/prometheus/grafana/alertmanager) got the same treatment. **No changes needed at any of the existing 38 `TailscaleIngress`/`createIngress` call sites** except the 2 module overrides below.
- **`createCloudflareTunnelBinding`** (`packages/homelab/src/cdk8s/src/misc/cloudflare-tunnel.ts`, edit) — added a **new required `port: number` prop** (needed so the 5 CF-only services, which have no companion `TailscaleIngress` call, still get a backend probe registered). Registers both a backend probe (deduped) and unconditionally a public probe. Required a one-line `port: <n>` addition at all 21 call sites, plus `disableProbe: true` at the one call inside `s3-static-site.ts` (which already has bespoke per-endpoint Probe coverage — auto-probing it would be a redundant duplicate).
- **`packages/homelab/src/cdk8s/src/misc/http-probe.ts`** (new) — `createHttpProbe(scope, id, props)`: the actual `Probe` CRD builder, generalized from `s3-static-site.ts`, used only by the finalization pass.
- **`packages/homelab/src/cdk8s/src/misc/blackbox-modules.ts`** (edit) — added `tcp_connect` (prober: `tcp`) and `https_2xx_insecure` (http prober + `tls_config.insecure_skip_verify: true`).
- **`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/service-probes.ts`** (new) — `getServiceProbeRuleGroups()`: `ServiceProbeDown` (`probe_success{job=~"probe-.*"} == 0`, `for: 10m`, `severity: warning`) and `ServiceProbeAbsent`, with `{{ $labels.path }}` in the summary so a firing alert says which layer broke.
- **`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/prometheus.ts`** (edit) — registered the new rule group.

### 2. Finalization pass

- **`packages/homelab/src/cdk8s/src/resources/monitoring/service-probes-chart.ts`** (new) — `createServiceProbesChart(app)`, a dedicated `Chart` (namespace `prometheus`) that loops the fully-populated registry and emits one `Probe` per descriptor (`probe-<namespace>-<service>-internal` / `-public`).
- Wired into **`setup-charts.ts`** as the **last** call inside `setupCharts(app)`, after a `resetProbeRegistry()` call at the very top (see Caveats).

### 3. Per-service touch points

- 38 `TailscaleIngress`/`createIngress` call sites: zero changes, except `temporal-server` (`probeModule: "tcp_connect"`) and `argocd` (`probeModule: "https_2xx_insecure"`).
- 21 `createCloudflareTunnelBinding` call sites: one-line `port: <n>` addition each (ports verified against each file's adjacent `Service`/constant definition, not assumed), plus `tcp_connect` on the 3 Temporal webhook services (POST-only receivers — an HTTP probe hitting GET `/` would 404/405 even when healthy).

### 4. NetworkPolicy updates (13 namespaces)

Added an ingress rule allowing the `prometheus` namespace (matching the existing `home-ingress-policy`/`media-ingress-policy` shape) to: `freshrss`, `birmel`, `postal` (`postal-web-netpol`), `pinchtab`, `plausible`, `tasknotes`, `temporal` (both `temporal-server-netpol` and `temporal-ui-netpol`), `mcp-gateway`, `redlib`, `syncthing`, `bugsink`, `relay`, `trmnl-dashboard`. The other ~24 involved namespaces needed no change.

## Verification

1. `bun run typecheck` — pass.
2. `bun run test` — cdk8s 190/190, helm-types 252/252, including new `probe-registry.test.ts` (dedup correctness — the crux of the design), `blackbox-modules.test.ts`, `http-probe.test.ts`, and a new `ServiceProbeDown` case in `pagerduty-alerting.test.ts`.
3. `bunx eslint . --fix` — clean (fixed 3 `strict-boolean-expressions` warnings by using `!== true` instead of `!` on the optional `disableProbe` boolean).
4. Rendered `dist/service-probes.k8s.yaml`: **63 total `Probe` resources** (43 internal + 20 public — not 64 as estimated in the plan, since `s3-static-sites` opts out of both backend and public auto-probes). Zero duplicate names — dedup confirmed working for all 16 overlap services (e.g. `argocd`, `bugsink`, `homeassistant` each show exactly one `-internal` + one `-public`). Module overrides confirmed correct (`argocd` backend = `https_2xx_insecure` targeting `https://argocd-server.argocd.svc.cluster.local:443/`; `temporal-server` = `tcp_connect` targeting `host:7233`; webhook services = `tcp_connect` on both internal and public).
5. Spot-checked a rendered `NetworkPolicy` (bugsink) — new prometheus-ingress rule present.
6. Full pre-commit (tier-1 + tier-2: helm lint, 1Password lint, quality ratchet, tunnel-DNS coverage, prettier, eslint) — pass.
7. Opened **PR #1505**.

## Session Log — 2026-07-12

### Done

- Implemented the full auto-registration design: `probe-registry.ts`, `http-probe.ts`, `blackbox-modules.ts` additions, `TailscaleIngress`/`createIngress`/`createCloudflareTunnelBinding` edits, `service-probes.ts` alert rule, `service-probes-chart.ts` finalization pass, `setup-charts.ts` wiring.
- Added `port` to all 21 `createCloudflareTunnelBinding` call sites, `probeModule` overrides for `temporal-server`/`argocd`, and `disableProbe` for `s3-static-sites`.
- Updated 13 NetworkPolicy files to allow prometheus-namespace ingress.
- Wrote 3 new test files (`probe-registry.test.ts`, `blackbox-modules.test.ts`, `http-probe.test.ts`) plus a new PagerDuty routing test case.
- Found and fixed a real cross-test-file state-leak bug (module-level registry needed a reset at the top of `setupCharts()`) during verification — see Caveats.
- Verified end-to-end: typecheck, full test suite, lint, rendered-manifest inspection (63 Probes, zero dupes, correct modules), NetworkPolicy spot-check, full pre-commit.
- Opened PR #1505.

### Remaining

- Merge PR #1505, let ArgoCD sync, then confirm live: all 63 `probe_success` series report `1` via Prometheus, and `ServiceProbeDown`/`ServiceProbeAbsent` don't misfire in the first 24h.
- **Forward-looking check** (the actual point of this design): the next time a new service is added with `TailscaleIngress`/`createCloudflareTunnelBinding`, confirm no separate action is needed for it to show up in `probe_success`.
- Decide whether to resume the still-dormant `feature/torvalds-memory-rightsize` worktree (noted in the prior Scrypted-fix session, unrelated to this work) for the broader cluster memory-overcommit audit.

### Caveats

- **Module-level registry state leaks across independent `App`/`setupCharts()` invocations in the same process** — this is inherent to the design (a plain exported `Map`/array), not a bug introduced by a specific call site. It only matters because the test suite's ~28 files each build their own `App` and call `setupCharts()` (or an individual chart function) within one bun:test process. Fixed by calling `resetProbeRegistry()` at the top of `setupCharts()`, which is safe in production too (a single real run just clears an already-empty registry). If a future test calls an individual chart-creation function directly (bypassing `setupCharts()` entirely) many times in a row, its registrations would sit unconsumed until the next `setupCharts()`-based test resets them away — harmless, since `createServiceProbesChart` is only ever invoked from inside `setupCharts()`.
- The plan's "64 Probe resources" estimate was off by one category: it didn't account for `s3-static-sites` opting out of _both_ the backend and public auto-probe (only the public-probe opt-out was originally planned for); the actual, correct count is 63 backend+public probes total, verified against the rendered manifest.
- Did not independently re-verify every single Service `metadata.name` before this session (a few — home-assistant, zwave-js-ui, bugsink, plausible, birmel-oauth, postal-web — were flagged as unconfirmed during planning); all were read directly from source during implementation, not assumed.
