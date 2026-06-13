import type { RecallDb } from "./db.ts";
import type { EmbeddingClient } from "./embeddings.ts";

export type SearchResult = {
  path: string;
  title: string;
  chunk: string;
  score: number;
  source: string;
  chunkIndex: number;
};

export type SearchOptions = {
  query: string;
  limit: number;
  mode: "hybrid" | "semantic" | "keyword";
  verbose: boolean;
};

type SearchStatOptions = {
  start: number;
  query: string;
  resultCount: number;
  mode: SearchOptions["mode"];
};

/**
 * Hybrid search: vector similarity + FTS5 keyword search, merged via RRF.
 *
 * Fusion happens at the document level: the FTS index has one row per
 * document while vector hits are per-chunk, so vector hits are collapsed
 * to their best-ranked chunk per document before fusing on path. A
 * document surfaced by both methods gets its RRF scores summed, ranking
 * it above documents found by only one.
 */
export async function hybridSearch(
  db: RecallDb,
  embedder: EmbeddingClient | null,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { query, limit, mode, verbose } = options;
  const start = performance.now();
  const candidateLimit = limit * 3;

  let vectorResults: SearchResult[] = [];
  let ftsResults: SearchResult[] = [];

  // Vector search
  if (mode !== "keyword" && embedder != null) {
    const embedStart = performance.now();
    let queryVector: number[];

    try {
      const vectors = await embedder.embed([query]);
      queryVector = vectors[0] ?? [];
    } catch {
      if (verbose) {
        console.error(
          "[search] embedding failed, falling back to keyword-only",
        );
      }
      const fallbackResults = keywordSearch(db, query, limit, verbose);
      recordSearchStat(db, {
        start,
        query,
        resultCount: fallbackResults.length,
        mode,
      });
      return fallbackResults;
    }

    const embedMs = performance.now() - embedStart;

    const vecStart = performance.now();
    let vecCandidates: Awaited<ReturnType<RecallDb["vectorSearch"]>>;
    try {
      // Chunk-level hits collapse to far fewer documents (large docs can
      // occupy many of the top slots), so over-fetch chunks to still get
      // ~candidateLimit distinct documents for fusion.
      vecCandidates = await db.vectorSearch(queryVector, candidateLimit * 10);
    } catch (error) {
      if (mode === "semantic") {
        recordSearchStat(db, {
          start,
          query,
          resultCount: 0,
          mode,
        });
        throw error;
      }

      if (verbose) {
        console.error(
          `[search] vector search failed, falling back to keyword-only: ${String(error)}`,
        );
      }
      const fallbackResults = keywordSearch(db, query, limit, verbose);
      recordSearchStat(db, {
        start,
        query,
        resultCount: fallbackResults.length,
        mode,
      });
      return fallbackResults;
    }
    const vecMs = performance.now() - vecStart;

    if (verbose) {
      console.error(
        `[search] embed: ${String(Math.round(embedMs))}ms, vec: ${String(vecCandidates.length)} candidates in ${String(Math.round(vecMs))}ms`,
      );
    }

    // Candidates arrive sorted by distance, so the first chunk seen for a
    // document is its best one. Cap at candidateLimit docs so both fusion
    // lists have comparable rank depth.
    vectorResults = collapseToBestChunkPerDoc(
      vecCandidates.map((row) => {
        const meta = db.getMetadata(row.doc_path);
        return {
          path: row.doc_path,
          title: meta?.title ?? "",
          chunk: row.text,
          score: 1 / (1 + row._distance), // Convert distance to similarity
          source: meta?.source ?? "unknown",
          chunkIndex: row.chunk_index,
        };
      }),
    ).slice(0, candidateLimit);
  }

  // FTS search
  if (mode !== "semantic") {
    const ftsStart = performance.now();
    const ftsCandidates = db.searchFts(query, candidateLimit);
    const ftsMs = performance.now() - ftsStart;

    if (verbose) {
      console.error(
        `[search] fts: ${String(ftsCandidates.length)} candidates in ${String(Math.round(ftsMs))}ms`,
      );
    }

    ftsResults = ftsCandidates.map((row) => {
      const meta = db.getMetadata(row.path);
      return {
        path: row.path,
        title: row.title,
        chunk: row.body.slice(0, 500), // Truncate for display
        score: -row.rank, // FTS5 rank is negative (lower = better)
        source: meta?.source ?? "unknown",
        chunkIndex: 0,
      };
    });
  }

  // Merge via RRF or return single source
  let results: SearchResult[];
  if (mode === "semantic") {
    results = vectorResults;
  } else if (mode === "keyword" || embedder == null) {
    results = ftsResults;
  } else {
    results = reciprocalRankFusion(vectorResults, ftsResults);
  }

  // Deduplicate by document path
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  const finalResults = deduped.slice(0, limit);
  const totalMs = recordSearchStat(db, {
    start,
    query,
    resultCount: finalResults.length,
    mode,
  });

  if (verbose) {
    console.error(
      `[search] total: ${String(finalResults.length)} results in ${String(Math.round(totalMs))}ms`,
    );
  }

  return finalResults;
}

function recordSearchStat(
  db: RecallDb,
  { start, query, resultCount, mode }: SearchStatOptions,
): number {
  const totalMs = performance.now() - start;
  db.recordStat("search", totalMs, {
    query,
    results: resultCount,
    mode,
  });
  return totalMs;
}

/**
 * Reciprocal Rank Fusion: merges two ranked lists of documents.
 * RRF(d) = Σ 1/(k + rank(d)) for each list containing d
 *
 * Lists are fused on document path; both inputs must already be one
 * entry per document. When both lists contain a document, the first
 * list's entry wins (callers pass the vector list first so the
 * best-matching chunk excerpt is kept over the FTS document head).
 */
function reciprocalRankFusion(
  listA: SearchResult[],
  listB: SearchResult[],
  k = 60,
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>();

  for (const list of [listA, listB]) {
    for (const [rank, result] of list.entries()) {
      const existing = scores.get(result.path);
      const rrfScore = 1 / (k + rank + 1);
      if (existing == null) {
        scores.set(result.path, { score: rrfScore, result });
      } else {
        existing.score += rrfScore;
      }
    }
  }

  return [...scores.values()]
    .toSorted((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}

/**
 * Collapses chunk-level results (sorted best-first) to one entry per
 * document, keeping each document's best chunk.
 */
function collapseToBestChunkPerDoc(results: SearchResult[]): SearchResult[] {
  const byDoc = new Map<string, SearchResult>();
  for (const result of results) {
    if (!byDoc.has(result.path)) {
      byDoc.set(result.path, result);
    }
  }
  return [...byDoc.values()];
}

function keywordSearch(
  db: RecallDb,
  query: string,
  limit: number,
  verbose: boolean,
): SearchResult[] {
  const ftsStart = performance.now();
  const results = db.searchFts(query, limit);
  const ftsMs = performance.now() - ftsStart;

  if (verbose) {
    console.error(
      `[search] keyword-only: ${String(results.length)} results in ${String(Math.round(ftsMs))}ms`,
    );
  }

  return results.map((row) => {
    const meta = db.getMetadata(row.path);
    return {
      path: row.path,
      title: row.title,
      chunk: row.body.slice(0, 500),
      score: -row.rank,
      source: meta?.source ?? "unknown",
      chunkIndex: 0,
    };
  });
}
