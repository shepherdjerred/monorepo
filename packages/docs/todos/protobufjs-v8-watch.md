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

The deterministic Temporal workflow polls
`https://registry.npmjs.org/@temporalio/proto/latest` weekly and reports the
current package version and protobufjs range every run.

## Remaining

- [ ] Monitor `@temporalio/proto` until its declared `protobufjs` dependency accepts v8.
- [ ] Once unblocked, remove the root override and Renovate `<8` rule, regenerate the lockfile, and prove the Temporal worker can process a workflow payload.
- [ ] After that cleanup ships, hand the live schedule removal to `protobufjs-v8-schedule-cleanup`.

## Scheduled implementation

`protobufjs-v8-watch-weekly` is declared in the Temporal schedule registry and
runs Monday at 09:00 PT. It validates typed npm registry data and sends a
stable/pending heartbeat while the dependency remains on v7. Once v8 is
accepted, it sends attention plus a retirement recommendation. The workflow
does not disable itself; remove the schedule only after the migration and
runtime payload verification are complete.

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
