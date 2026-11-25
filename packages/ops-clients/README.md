# @shepherdjerred/ops-clients

Fetch-based upstream clients for the ops overview, validated with Zod. Each
client takes an injected `fetch` and its credentials, so it runs the same in
the Temporal collector, Hub, and tests.

`http.ts` owns the shared contract. `fetchJson` rejects non-2xx responses and
schema mismatches with an `UpstreamError`. The error message is bounded and
never includes the upstream body, so callers can show it in a snapshot
without leaking payloads.

| Module            | Upstream and what it reads                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prometheus.ts`   | Instant and range PromQL queries.                                                                                                                                               |
| `kubernetes.ts`   | Nodes, non-completed pods, ArgoCD history, and Velero Schedules with required owner-published monitoring annotations.                                                           |
| `alertmanager.ts` | Unsilenced, uninhibited firing alerts and active silences (v2 API).                                                                                                             |
| `bugsink.ts`      | Projects, unresolved issues, and bounded-concurrency project summaries on the configured origin only.                                                                           |
| `github.ts`       | GraphQL + REST: open PRs (exact-head review), merged PRs, rate limits, PR bodies, upstream releases, and commit compares.                                                       |
| `renovate.ts`     | Pure parser for Dependency Dashboard markers, Ignored/Blocked items, deprecations, lookup warnings, and truncation.                                                             |
| `tracker.ts`      | Credentialless tRPC: open issues, active forum notices/questions, per-project counts, and 7d completed throughput.                                                              |
| `posthog.ts`      | HogQL: 24h pageviews, top pages, 7d site traffic summaries, p75 web vitals, external referrers, and funnel windows.                                                             |
| `loki.ts`         | Instant LogQL queries (severity error lines, 24h byte volume, 1h Kubernetes warning events) and Ruler rule counts.                                                              |
| `cloudflare.ts`   | Zones, DNSSEC + SPF/DMARC/MX/MTA-STS baselines, R2 buckets + GraphQL storage metrics, Tunnel routes, and RDAP expiry.                                                           |
| `tailscale.ts`    | Tailnet devices (`?fields=all`) via API key or OAuth client credentials with normalized control status and key expiry.                                                          |
| `golink.ts`       | Golink `/api/links` directory normalized by slug, tier, clicks, and shadowed target metadata.                                                                                   |
| `tempo.ts`        | TraceQL search (with `spss` span-set and `serviceStats` enrichment), OTLP JSON `getTrace`, `/ready` health check, and `buildLlmTraceQl`; flags a full result page as truncated. |
| `woodpecker.ts`   | The newest push pipeline and the newest verdict of a branch.                                                                                                                    |

Unknown enum values from an upstream (a new Argo health, a Woodpecker status,
a Tracker state type) fail schema validation instead of being guessed.

Tracker takes separate `baseUrl` and `publicUrl` bootstrap addresses. Requests
use the private API transport; issue links use the browser-facing origin.

ArgoCD root operations retain their raw identity through validation. Only an
exact matching owner-published release receipt sets `verifiedReleaseTermination`;
the collector continues to evaluate current health and sync independently.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-clients
```
