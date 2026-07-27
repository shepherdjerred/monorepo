---
id: protobufjs-v8-watch
type: todo
status: planned
board: true
verification: agent
disposition: blocked
origin: PR
source_marker: false
---

# Watch for `@temporalio/proto` to support protobufjs v8

## What

The `protobufjs: ^7.5.7` override in the root `package.json` is load-bearing — it forces the entire Bun workspace onto protobufjs v7 because `@temporalio/proto@1.18.1` pins `protobufjs: 7.5.8` exact, and `@temporalio/worker` / `@grpc/proto-loader` / `proto3-json-serializer` all use `^7.x`. Forcing v8 (Edition-2024 rewrite, breaking) via the override would silently replace the v7 build that `@temporalio/proto` was compiled against and break Temporal payload (de)serialization at runtime — no source code in `packages/temporal/src` imports protobufjs directly, so typecheck/lint won't catch it. The previous attempt landed as PR #1215 (`bca5ef7fc`) and was reverted by `acc7320dc fix(temporal): keep protobufjs override at ^7.5.7 — v8 incompatible with Temporal SDK`. PR #1227 is Renovate reopening the same upgrade.

A `renovate.json` packageRule (`allowedVersions: "<8"`) now stops Renovate from auto-opening this PR every Sunday. The v8 bump surfaces on the Dependency Dashboard issue as an ignored entry — passive backstop visibility without gating v7 patches.

The agent task below polls `https://registry.npmjs.org/@temporalio/proto/latest` weekly and emails only when the pin moves off `7.x`.

## Remaining

- [ ] Monitor `@temporalio/proto` until its declared `protobufjs` dependency accepts v8.
- [ ] Once unblocked, remove the root override and Renovate `<8` rule, regenerate the lockfile, and prove the Temporal worker can process a workflow payload.
- [ ] After that cleanup ships, hand the live schedule removal to `protobufjs-v8-schedule-cleanup`.

## How to schedule

Run once locally as an operator (assumes a port-forward or direct grpc reachability to the cluster Temporal server, or a local dev server):

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts \
  --from-doc ../../packages/docs/todos/protobufjs-v8-watch.md
```

Caveat: this depends on `agentTaskWorkflow` actually running. The historical
failure umbrella is archived at
`packages/docs/archive/superseded/agent-task-workflow-broken.md`; current
production proof is tracked by
`packages/docs/todos/homelab-audit-agent-task-production-verification.md`. A
five-second curl-and-email task is mechanically different from the full
homelab audit, but the Renovate dashboard pin remains authoritative until the
shared path has current green evidence.

<!-- temporal-agent-task
{
  "title": "Check if @temporalio/proto supports protobufjs v8",
  "provider": "claude",
  "mode": "report-only",
  "cron": "0 9 * * 1",
  "scheduleId": "protobufjs-v8-watch-weekly",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/todos/protobufjs-v8-watch.md"
  },
  "prompt": "Fetch https://registry.npmjs.org/@temporalio/proto/latest and read .dependencies.protobufjs from the response JSON. If that value starts with 8, ^8, ~8, or >=8 (i.e. v8 is now accepted), email a report with subject 'protobufjs v8 unblocked' and a body containing: (a) the @temporalio/proto version that widened the pin, (b) the new protobufjs pin string, (c) a link to the temporalio/sdk-typescript GitHub release notes for that version, and (d) a one-line next step pointing at this todo (packages/docs/todos/protobufjs-v8-watch.md) for the cleanup PR. If the pin still starts with 7 or 7., return an empty string and do not send an email. Do not modify any files or open any PRs/issues."
}
-->

## References

- Originating revert: commit `acc7320dc` — `fix(temporal): keep protobufjs override at ^7.5.7 — v8 incompatible with Temporal SDK`
- Renovate PR that triggered this watch: #1227 (closed without merging)
- protobufjs v8 changelog: <https://github.com/protobufjs/protobuf.js/releases/tag/protobufjs-v8.0.0> (Edition 2024 rewrite, breaking)
- `@temporalio/proto` npm: <https://www.npmjs.com/package/@temporalio/proto>

## Comment Log

### 2026-07-27 — Awaiting-human audit

Reclassified as an agent-owned upstream watch. Local source still shows the root
protobufjs v7 override, the Renovate `<8` guard, and an exact v7 dependency in
the lockfile; no user acceptance decision is pending.
