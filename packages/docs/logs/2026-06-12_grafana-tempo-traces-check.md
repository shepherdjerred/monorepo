# Grafana + Tempo Tracing Setup — Verification

## Status

Complete

## Question

Do we have Grafana set up with Tempo and traces? (Q&A session — no code changes.)

## Answer

Yes, fully wired and actively ingesting:

- **Tempo** deployed via ArgoCD (`packages/homelab/src/cdk8s/src/resources/argo-applications/tempo.ts`): SingleBinary mode, `tempo` namespace, OTLP gRPC `:4317` / HTTP `:4318`, 30d retention, 64Gi NVMe PVC with Velero backup, 50MB max trace size (for Dagger), metrics-generator → Prometheus remote write.
- **Grafana datasource** (`argo-applications/grafana-values.ts:135-154`): `tempo` uid at `http://tempo.tempo.svc:3200`, with `tracesToLogsV2` → Loki (matched on `service.name`, ±5m), `serviceMap` → Prometheus, `nodeGraph` enabled. Pyroscope datasource also present.
- **Senders** (OTLP to `http://tempo.tempo.svc.cluster.local:4318`): Dagger CI, birmel, scout, temporal-worker, mario-kart, pokemon.

## Live verification (via Grafana API, 2026-06-12)

- `toolkit grafana datasources` confirms tempo/loki/pyroscope/prometheus datasources live.
- Tempo search over the last hour returned active traces (birmel `job.aggregate-activity`, `job.check-birthdays`, `scheduler.checkDailyPosts`, prisma spans).
- `service.name` tag values: birmel, temporal-worker, dagger-ci (+ ~20 per-check dagger-ci-\* services), dagger-go-sdk, `unknown_service:dagger-engine`. Scout/mario-kart/pokemon had no traces in retention via tag listing — worth a look if scout tracing is expected to be active.

Grafana UI: `https://grafana.tailnet-1a49.ts.net` (Tailscale ingress, host `grafana`). Opened Explore with the tempo datasource preselected.

## Follow-up: why scout / mario-kart / pokemon were "missing" from Tempo

### scout — false alarm, it works

- `gen_ai.chat` traces ARE in Tempo for `resource.service.name = "scout-backend"` (verified via TraceQL search over 7d). The earlier `/api/search/tag/service.name/values` listing simply has a limited lookback and missed it.
- Scout only traces LLM calls (`traceOpenAi`/`traceGemini` in `packages/scout-for-lol/packages/backend/src/league/review/ai-clients.ts`); prod has no `OPENAI_API_KEY`/`GEMINI_API_KEY` so only beta emits, sparsely.
- Init order is correct (`initializeTracing()` before `Sentry.init`), so scout's NodeSDK owns the global tracer provider; the startup `duplicate registration of API: context` error is harmless noise (scout's tracing.ts manually registers an `AsyncLocalStorageContextManager`, then `sdk.start()` tries to register another), and Sentry's later `initOtel` failing `trace`/`propagation` registration is expected.

### mario-kart — real bug: Sentry steals the tracer provider

- `packages/discord-plays-mario-kart/packages/backend/src/index.ts` calls `Sentry.init()` at the top **without `skipOpenTelemetrySetup: true`**, before `initializeTracing()`.
- `@sentry/bun` registers the global OTel `trace`/`context`/`propagation` APIs first; the app's NodeSDK then fails all three registrations (`duplicate registration of API: trace` confirmed in pod logs). Spans route through Sentry's provider/sampler (`tracesSampleRate` unset → all dropped). Zero traces in Tempo over 7d.
- Fix (same as birmel, see comment in `packages/birmel/src/observability/sentry.ts`): add `skipOpenTelemetrySetup: true` to `Sentry.init`.

### pokemon — intentionally scaled to 0

- Deployment has `replicas: 0` on main (commit `6a509c790 feat(homelab): scale pokemon deployment to 0 replicas`); nothing runs, so no traces. The stale 4d-old `Unknown` pod is leftover from today's node reboot.
- Its `index.ts` has the identical Sentry-before-tracing bug as mario-kart, so once scaled back up it still won't trace until fixed.

### pyroscope datasource — dead on arrival (bonus finding)

- Provisioned with `type: "grafanapyroscope"`, which is not a registered plugin (`/api/datasources/uid/pyroscope/health` → `plugin.notRegistered`). Profiles Drilldown showed "Missing Pyroscope data source" and all queries failed.
- Correct plugin ID on Grafana v13 is `grafana-pyroscope-datasource`; fixed in `grafana-values.ts` (same PR #1130).

### eBPF profiling — broken by kernel lockdown=confidentiality (fixed live by owner)

- After today's Talos reinstall (secure boot), the kernel booted with `lockdown=confidentiality` (Talos appends it via `SecureBootArgs`, `pkg/machinery/kernel/kernel.go`). Confidentiality lockdown denies `LOCKDOWN_BPF_READ_KERNEL`, so the verifier rejects `bpf_probe_read*` helpers.
- Failure chain in Alloy v1.16.1: cilium/ebpf's `haveProbeReadKernel` feature probe fails under lockdown → `fixupProbeReadKernel` silently rewrites helper #113 → legacy #4 → verifier error `program of this type cannot use helper bpf_probe_read#4` → `pyroscope.ebpf` component unhealthy, zero eBPF profiles.
- The committed profiler bytecode is clean (18× `bpf_probe_read_kernel`, 0× legacy) — the legacy helper appears only via cilium/ebpf's load-time downgrade, which made the error message misleading.
- Owner switched the node to `lockdown=integrity`; eBPF tracer then loaded ("eBPF tracer loaded" in alloy logs). Integrity mode still blocks kernel-memory _writes_ but permits BPF reads.
- Verified end-to-end: 103 services with profiles in Pyroscope within 10 minutes of the fix, zero push errors. (Initial `deadline_exceeded` push errors right after the fix were just pyroscope-0 restarting; they stopped once it passed readiness.)

## Session Log — 2026-06-12

### Done

- Verified Tempo + Grafana trace wiring in cdk8s source and against the live API; opened Grafana Explore in browser.
- Root-caused the three "silent" services (see follow-up section above): scout works (sparse LLM-only traces), mario-kart broken by Sentry OTel-global registration order, pokemon scaled to 0 (+ same Sentry bug latent).
- Fixed the dead pyroscope datasource type in `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts` (PR #1130).
- Fixed the Sentry bug in both bots: added `skipOpenTelemetrySetup: true` to `Sentry.init` in `packages/discord-plays-{mario-kart,pokemon}/packages/backend/src/index.ts` (PR #1130, typecheck + lint green).

### Remaining

- Post-merge: verify mario-kart traces appear in Tempo after its next deploy (`{ resource.service.name =~ "discord-plays.*" }` in Grafana Explore). Pokemon stays silent until intentionally scaled back up from 0. Also verify pyroscope datasource health + Profiles Drilldown after the grafana ArgoCD app syncs.

### Caveats

- Tempo search API caps query ranges at 168h; longer ranges 400 and `curl -sf` hides the error — query in ≤7d windows.
- The Tempo `service.name` tag-values endpoint has a short default lookback; absence there does not mean absence in storage. Use TraceQL search to confirm.
- PinchTab's headless profile is not logged into Grafana, so UI verification fell back to the API + opening Explore links in the user's own browser.
