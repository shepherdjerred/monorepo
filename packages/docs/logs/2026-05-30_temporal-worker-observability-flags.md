# Temporal Worker Observability Flags

## Status

Complete

## Summary

Enabled the low-risk Temporal Server v1.29 dynamic config flags needed for worker heartbeat ingestion and worker listing in the Temporal UI.

## Session Log — 2026-05-30

### Done

- Updated `packages/homelab/src/cdk8s/src/resources/temporal/dynamic-config.ts` to use the exact v1.29 key casing for `frontend.WorkerHeartbeatsEnabled`.
- Added `frontend.ListWorkersEnabled` so the UI can list worker heartbeat information on Temporal Server v1.29.
- Extended `packages/homelab/src/cdk8s/src/temporal-audit-tooling.test.ts` with a focused regression check for the dynamic config keys.
- Verified the generated `packages/homelab/src/cdk8s/dist/temporal.k8s.yaml` contains `frontend.WorkerHeartbeatsEnabled` and `frontend.ListWorkersEnabled`, with no stale `frontend.workerHeartbeatsEnabled`.
- Ran `bun run typecheck`, `bun test src/temporal-audit-tooling.test.ts`, `bun run build`, and `bun run lint` from `packages/homelab/src/cdk8s`.
- Ran the full `bun run test` suite from `packages/homelab/src/cdk8s`: 108 passed, 5 skipped, 0 failed, plus GPU resource checks passed.

### Remaining

- After ArgoCD syncs the Temporal chart, verify the Temporal UI Workers tab no longer reports worker heartbeats/listing disabled.

### Caveats

- `mise` emitted a non-fatal warning while trying to track the trusted config under `~/.local/state/mise`; the verification commands still completed.
- The cdk8s and helm-types workspace dependencies were missing in this worktree, so `bun install --frozen-lockfile` was run in both subpackages before verification.
