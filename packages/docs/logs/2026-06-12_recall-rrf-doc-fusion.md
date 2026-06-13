# Recall Hybrid Search — Fix RRF Fusion to Document Level

## Status

Complete

## Context

While reviewing the "Files Are All You Need" / "FUSE is All You Need" articles, we
smoke-tested `toolkit recall search` and noticed every result had the identical
score `0.016` regardless of query, with irrelevant "hub" docs (large research
files) ranking above known-relevant docs.

## Root cause

`packages/toolkit/src/lib/recall/search.ts` merged the vector and FTS lists via
Reciprocal Rank Fusion keyed on `path:chunkIndex`. But the two lists live at
different granularities:

- FTS5 (`docs_fts`) has **one row per document**; its results were hardcoded to
  `chunkIndex: 0`.
- Vector search (LanceDB) returns **per-chunk** hits with real chunk indices.

A document found by both methods therefore almost never matched on the fusion
key, so the RRF "found by both" boost effectively never fired. The output was a
blind interleave of the two lists where every score collapsed to
`1/(60+rank)` ≈ 0.016.

A secondary issue compounded it: the vector candidate pool was only
`limit * 3 = 30` **chunks**, and large documents occupy many of those slots, so
the vector list often contained only a handful of distinct documents — making
overlap with the FTS list rare even at the document level.

## Fix

- Collapse vector chunk hits to their best-ranked chunk per document
  (`collapseToBestChunkPerDoc`), then fuse the two lists on **document path**.
- Over-fetch vector candidates (`candidateLimit * 10` chunks) and cap the
  collapsed list at `candidateLimit` docs so both fusion lists have comparable
  rank depth.
- Fused entries keep the vector hit's chunk excerpt (more specific than the FTS
  document head); final dedup is by path, so a document can no longer occupy
  multiple result slots.

## Verification

- Two new regression tests in `packages/toolkit/test/recall/search.test.ts`
  using a canned-vector `RecallDb` test double: cross-method fusion outranks
  single-method docs, and multi-chunk docs collapse to their best chunk.
- Live index: `toolkit recall search "1password connect secrets"` now ranks the
  1Password dedup decision doc #1 with a summed score (0.029) above all
  single-method results (0.016). Pre-fix, the same doc ranked below an
  unrelated research doc.

## Known issues out of scope (candidates for follow-up)

- **Query embedding cold start**: ~7s of every search is the MLX embedder
  loading; vector search itself is ~180ms and FTS ~20ms. Serving query
  embeddings from the already-running daemon would make search interactive.
- **Weak semantic discrimination**: bge-m3 scores for relevant vs irrelevant
  docs sit in a narrow band (0.60–0.63), and large hub docs still crowd the
  vector list for some queries (e.g. Tailwind queries surface Bazel research).
  Worth evaluating keyword-only mode (`--mode keyword`, ~20ms) as the default,
  or a rerank step, before investing more in the semantic side.

## Session Log — 2026-06-12

### Done

- Fixed doc-level RRF fusion in `packages/toolkit/src/lib/recall/search.ts`
- Added regression tests in `packages/toolkit/test/recall/search.test.ts`
- Verified: typecheck, 7/7 tests, eslint clean, live-index behavior confirmed

### Remaining

- Nothing for this fix. Follow-up candidates listed above (daemon-served query
  embeddings; evaluate keyword-default) were explicitly left out of scope.

### Caveats

- Scores are only differentiated when a doc is found by both methods; flat
  0.016 rows are still expected for single-method hits — that's correct RRF
  behavior, not the old bug.
- The rebuilt binary must be reinstalled (`./install.sh` in packages/toolkit)
  for the global `~/.local/bin/toolkit` to pick up the fix.
