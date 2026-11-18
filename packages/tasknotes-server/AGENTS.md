# TaskNotes server constraints

This Bun/Hono server implements the Facet sync API (`/api/v1/sync` and REST
`/api/v1/*`) backed by PostgreSQL through Prisma. `README.md` owns routes,
configuration, and contributor reference.

- Wire types in `src/protocol/generated.ts` are generated from
  `packages/facet-protocol` via Typeshare. Never hand-edit generated protocol
  files; update the canonical Rust schema in `packages/facet-protocol` and run
  its `generate` script.
- Every mutation advances the global monotonic `sync_seq` watermark atomically
  and records command `uuid` receipts in `SyncCommandLog` so retried client
  batches never execute twice.
- Soft deletes (`is_deleted = true`) preserve tombstones in incremental sync
  deltas (`sync_token > 0`) while omitting deleted records from full snapshots
  (`sync_token` omitted or `0`).
- Validate bearer auth (`AUTH_TOKEN`) and all request payloads with Zod schemas
  at the HTTP boundary. Never log tokens or user task content.
- Keep `/api/health`, `/api/engine-status`, `/metrics` (`tasknotes_uptime_seconds`
  and task counters), and the startup listening log intact for probes, smoke
  checks, and canary workflows.

```bash
bun run generate
bun run build
bun run typecheck
bun run test
bun run lint
```
