# @shepherdjerred/ops-clients

Fetch-based upstream clients for the ops overview, validated with Zod. Each
client takes an injected `fetch` and its credentials, so it runs the same in
the Temporal collector, the ops dashboard, and tests.

`http.ts` owns the shared contract. `fetchJson` rejects non-2xx responses and
schema mismatches with an `UpstreamError`. The error message is bounded and
never includes the upstream body, so callers can show it in a snapshot
without leaking payloads.

| Module            | Upstream and what it reads                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `prometheus.ts`   | Instant and range PromQL queries.                                                                                         |
| `kubernetes.ts`   | Nodes, non-completed pods, ArgoCD history, and Velero Schedules with required owner-published monitoring annotations.     |
| `alertmanager.ts` | Unsilenced, uninhibited firing alerts and active silences (v2 API).                                                       |
| `bugsink.ts`      | Projects and unresolved issues, following every cursor page on the configured origin only.                                |
| `github.ts`       | GraphQL: open PRs with checks, merged PRs by update time, path history, branch head, and one issue by title.              |
| `renovate.ts`     | A pure parser for the Dependency Dashboard's approval and pending-check markers.                                          |
| `tracker.ts`      | Credentialless tRPC: all open issues by team and state type, and triage.                                                  |
| `posthog.ts`      | HogQL: 24-hour pageviews by `site_key` and host, and the top pages.                                                       |
| `loki.ts`         | Instant LogQL queries; error-line counts use detected severity metadata and do not count words in informational messages. |
| `tempo.ts`        | TraceQL search for error and slow traces; flags a full result page as truncated.                                          |
| `woodpecker.ts`   | The newest push pipeline and the newest verdict of a branch.                                                              |

Unknown enum values from an upstream (a new Argo health, a Woodpecker status,
a Tracker state type) fail schema validation instead of being guessed.

ArgoCD root operations retain their raw identity through validation. Only an
exact matching owner-published release receipt sets `verifiedReleaseTermination`;
the collector continues to evaluate current health and sync independently.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-clients
```
