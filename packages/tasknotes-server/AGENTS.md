# TaskNotes server constraints

This Bun/Hono server implements the Facet sync API (`/api/v1/sync`), REST +
OpenAPI (`/api/v1/*`, `/api/v1/openapi.json`), Streamable HTTP MCP
(`/api/v1/mcp`), named API tokens (`fct_*`), and transactional mutation audit
tracking (`/api/v1/mutations`) backed by PostgreSQL through Prisma. `README.md`
owns routes, configuration, and contributor reference.

- Wire types in `src/protocol/generated.ts` are generated from
  `packages/facet-protocol` via Typeshare. Never hand-edit generated protocol
  files; update the canonical Rust schema in `packages/facet-protocol` and run
  its `generate` script.
- Every mutation advances the per-user monotonic `sync_seq` watermark atomically,
  records command `uuid` receipts in `ProcessedCommand` so retried client batches
  never execute twice, and writes an append-only `MutationEvent` inside the same
  transaction/savepoint when an `AuditContext` is active.
- Soft deletes (`is_deleted = true`) preserve tombstones in incremental sync
  deltas (`sync_token > 0`) while omitting deleted records from full snapshots
  (`sync_token` omitted or `0`).
- Validate bearer auth (`AUTH_TOKEN` for owner/admin and SHA-256 hashed `fct_*`
  `ApiToken` credentials pinned to `token.userId`) and all request payloads with
  Zod schemas at the HTTP boundary. Restrict `/api/v1/tokens*` and
  `/api/engine-status` to `AUTH_TOKEN` admin principals. Never store plaintext
  API tokens or log tokens or user task content.
- Keep `/api/health`, `/api/engine-status`, `/metrics` (`tasknotes_uptime_seconds`,
  task counters, and bounded `tasknotes_mutations_total`), and the startup
  listening log intact for probes, smoke checks, and canary workflows.

```bash
bun run generate
bun run build
bun run typecheck
bun run test
bun run test:extended
bun run lint
```
