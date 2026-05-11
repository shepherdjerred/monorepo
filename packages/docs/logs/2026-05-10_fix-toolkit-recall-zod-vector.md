# Fix `toolkit recall search` Zod crash

## Status

Complete

## Context

`toolkit recall search "<query>"` crashes immediately with:

```
ZodError: { path: ["vector"], expected: "array", received: "Vector" }
  at /$bunfs/root/toolkit:84:35
```

`recall status` and `recall debug` are fully green (1588 docs / 27519 chunks indexed, daemon running, embeddings available, all 7 watched dirs OK, 0 log errors). Index health is fine; only the read path is broken.

Root cause: in `vectorSearch()` (`packages/toolkit/src/lib/recall/db.ts:238-252`), `@lancedb/lancedb@0.27.2` returns query rows where the `vector` column is an Apache Arrow `Vector<Float>` wrapper, not a plain `number[]`. The Zod schema declares `vector: z.array(z.number())`. The current source has a defensive shim:

```typescript
const vec = Array.isArray(row["vector"]) ? row["vector"] : [];
```

But the installed binary at `~/.local/bin/toolkit` is from Mar 27 and the source defensive code is from Mar 28 — the live binary is _pre-fix_ and still parses the raw Vector. The current source is also wasteful: it forces an empty array through the schema for a field no caller reads (verified — `search.ts:64-74` reads only `doc_path`, `text`, `_distance`, `chunk_index`).

The clean fix: drop `vector` from the search-result schema entirely (it's still required on `ChunkRowSchema` for the **write** path in `pipeline.ts:123` and the init row at `db.ts:117-125`), then rebuild and reinstall.

## Approach

1. **Refactor `VectorSearchResultSchema`** at `packages/toolkit/src/lib/recall/db.ts:20-22` to omit `vector`:

   ```typescript
   const VectorSearchResultSchema = ChunkRowSchema.omit({
     vector: true,
   }).extend({
     _distance: z.number(),
   });
   ```

   Zod default behavior strips unknown keys, so the Arrow `Vector` object is silently dropped during parse — no defensive shim needed.

2. **Simplify `vectorSearch()`** at `db.ts:238-252` — remove the `vec` shim and the spread-then-override dance:

   ```typescript
   async vectorSearch(
     queryVector: number[],
     limit: number,
   ): Promise<z.infer<typeof VectorSearchResultSchema>[]> {
     const table = await this.getLanceTable();
     const raw = await table.vectorSearch(queryVector).limit(limit).toArray();
     return raw.map((row: Record<string, unknown>) => VectorSearchResultSchema.parse(row));
   }
   ```

   Public return type changes from `(ChunkRow & { _distance: number })[]` to `(Omit<ChunkRow, "vector"> & { _distance: number })[]`. `search.ts` doesn't read `.vector`, so no caller break.

3. **Leave `ChunkRowSchema` and `ChunkRow` alone.** Write path (`pipeline.ts:123`, `db.ts:117-125` init row) still constructs and inserts a `vector: number[]`.

4. **Rebuild and reinstall** via `./install.sh` from `packages/toolkit/`.

## Files Modified

| File                                    | Lines   | Change                                     |
| --------------------------------------- | ------- | ------------------------------------------ |
| `packages/toolkit/src/lib/recall/db.ts` | 20-22   | `.omit({ vector: true })` on search schema |
| `packages/toolkit/src/lib/recall/db.ts` | 238-252 | Drop `vec` shim, parse row directly        |

## Verification

```bash
cd /Users/jerred/git/monorepo/packages/toolkit
bun run typecheck
bun run src/index.ts recall search "toolkit recall architecture"
./install.sh
toolkit recall search "toolkit recall architecture"
toolkit recall debug
```

Expected: hybrid search (vector + FTS5 + RRF) returns ranked results, no Zod error.

## Out of Scope

- The missing `test/recall/` directory referenced by `package.json` `test:unit`.
- Pinning `@lancedb/lancedb` exact (still `^0.27.2`).

## Session Log — 2026-05-10

### Done

- `packages/toolkit/src/lib/recall/db.ts:20-24` — switched `VectorSearchResultSchema` to `ChunkRowSchema.omit({ vector: true }).extend({ _distance: z.number() })` and added `type VectorSearchResult = z.infer<...>`.
- `packages/toolkit/src/lib/recall/db.ts:240-249` — simplified `vectorSearch()`: removed the `Array.isArray` shim and spread/override; parses rows directly. Return type is now `Promise<VectorSearchResult[]>`.
- `bun run typecheck` — clean (`tsc --noEmit` no errors).
- Source-mode smoke test: `bun run src/index.ts recall search "toolkit recall architecture" --verbose` → 10 hybrid results, embed 10.2s + vec 108ms + fts 10ms + total 10.3s. No Zod error.
- Rebuilt + reinstalled global binary via `packages/toolkit/install.sh` → `dist/toolkit` (354 modules bundled in 88ms, compiled in 275ms) copied to `~/.local/bin/toolkit` (timestamp now `May 10 11:33`, was `Mar 27 14:08`).
- Installed-binary verification: `toolkit recall search "lancedb vector schema"` → 10 results clean. `toolkit recall status` → 1602 docs / 27774 chunks. `toolkit recall debug` → all infra checks green.
- Mirrored plan: `packages/docs/plans/2026-05-10_fix-toolkit-recall-zod-vector.md` + index entry in `packages/docs/index.md`.

### Remaining

- Nothing for this fix.

### Caveats

- `recall debug` reports `1 errors in recall-2026-05-10.log` — this is a **pre-existing, unrelated** YAML parse failure in `~/.claude/projects/-Users-jerred-git-monorepo/memory/reference_commit_msg_validation.md` (frontmatter description contains an unquoted colon: `` `type(scope): description` ``). The watcher logs it as `index_error` once per indexing pass. Not introduced by this change. Fix would be to quote that description value.
- Ran several `toolkit recall search` commands during testing that lingered as zombie processes after `head -N` closed the pipe early; killed manually. The daemon (`toolkit recall watch`, PID 14977) was untouched.
- The defensive `Array.isArray()` shim that was already in source (Mar 28 mtime) shipped but never reached the user — the installed binary at `~/.local/bin/toolkit` was from Mar 27. Worth a future hook/check that detects stale `~/.local/bin/toolkit` vs `packages/toolkit/src/`.
