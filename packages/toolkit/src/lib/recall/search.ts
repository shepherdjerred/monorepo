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

/**
 * Hybrid search: vector similarity + FTS5 keyword search, merged via RRF.
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
      return keywordSearch(db, query, limit, verbose);
    }

    const embedMs = performance.now() - embedStart;

    const vecStart = performance.now();
    const vecCandidates = await db.vectorSearch(queryVector, candidateLimit);
    const vecMs = performance.now() - vecStart;

    if (verbose) {
      console.error(
        `[search] embed: ${String(Math.round(embedMs))}ms, vec: ${String(vecCandidates.length)} candidates in ${String(Math.round(vecMs))}ms`,
      );
    }

    vectorResults = vecCandidates.map((row) => {
      const meta = db.getMetadata(row.doc_path);
      return {
        path: row.doc_path,
        title: meta?.title ?? "",
        chunk: row.text,
        score: 1 / (1 + row._distance), // Convert distance to similarity
        source: meta?.source ?? "unknown",
        chunkIndex: row.chunk_index,
      };
    });
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

  // Deduplicate by path + chunkIndex
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    const key = `${r.path}:${String(r.chunkIndex)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const finalResults = deduped.slice(0, limit);
  const totalMs = performance.now() - start;

  if (verbose) {
    console.error(
      `[search] total: ${String(finalResults.length)} results in ${String(Math.round(totalMs))}ms`,
    );
  }

  // Record stat
  db.recordStat("search", totalMs, {
    query,
    results: finalResults.length,
    mode,
  });

  return finalResults;
}

/**
 * Reciprocal Rank Fusion: merges two ranked lists.
 * RRF(d) = Σ 1/(k + rank(d)) for each list containing d
 */
function reciprocalRankFusion(
  listA: SearchResult[],
  listB: SearchResult[],
  k = 60,
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>();

  for (const [rank, result] of listA.entries()) {
    const key = `${result.path}:${String(result.chunkIndex)}`;
    const existing = scores.get(key);
    const rrfScore = 1 / (k + rank + 1);
    if (existing == null) {
      scores.set(key, { score: rrfScore, result });
    } else {
      existing.score += rrfScore;
    }
  }

  for (const [rank, result] of listB.entries()) {
    const key = `${result.path}:${String(result.chunkIndex)}`;
    const existing = scores.get(key);
    const rrfScore = 1 / (k + rank + 1);
    if (existing == null) {
      scores.set(key, { score: rrfScore, result });
    } else {
      existing.score += rrfScore;
    }
  }

  return [...scores.values()]
    .toSorted((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
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
