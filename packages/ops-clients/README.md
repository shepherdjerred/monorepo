# @shepherdjerred/ops-clients

Fetch-based upstream clients for the ops overview, validated with Zod. Each
client takes an injected `fetch` and its credentials, so it runs the same in
the Temporal collector, the ops dashboard, and tests.

`http.ts` owns the shared contract. `fetchJson` rejects non-2xx responses and
schema mismatches with an `UpstreamError`. The error message is bounded and
never includes the upstream body, so callers can show it in a snapshot
without leaking payloads.

| Module            | Upstream and what it reads                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `prometheus.ts`   | Instant and range PromQL queries.                                                                                |
| `kubernetes.ts`   | Nodes (Ready, versions), non-completed pods with a problem classification, and ArgoCD Applications with history. |
| `alertmanager.ts` | Unsilenced, uninhibited firing alerts and active silences (v2 API).                                              |
| `bugsink.ts`      | Projects and unresolved issues, following every cursor page on the configured origin only.                       |
| `github.ts`       | GraphQL: open PRs with checks, merged PRs by update time, path history, branch head, and one issue by title.     |
| `renovate.ts`     | A pure parser for the Dependency Dashboard's approval and pending-check markers.                                 |
| `linear.ts`       | GraphQL with a personal key: open issues by team and state type, triage, and active cycles.                      |
| `posthog.ts`      | HogQL: 24-hour pageviews by `site_key` and host, and the top pages.                                              |
| `loki.ts`         | Instant LogQL metric queries, including error-line volume per namespace.                                         |
| `buildkite.ts`    | The newest build and the newest pass/fail verdict of a branch.                                                   |

Unknown enum values from an upstream (a new Argo health, a Buildkite state,
a Linear state type) fail schema validation instead of being guessed.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-clients
```
