# @shepherdjerred/ops-clients

Fetch-based upstream clients for the ops overview, validated with Zod. Each
client takes an injected `fetch` and its credentials, so it runs the same in
the Temporal collector, the ops dashboard, and tests.

`http.ts` owns the shared contract. `fetchJson` rejects non-2xx responses and
schema mismatches with an `UpstreamError`. The error message is bounded and
never includes the upstream body, so callers can show it in a snapshot
without leaking payloads.

```bash
bunx turbo run typecheck test lint --filter=@shepherdjerred/ops-clients
```
