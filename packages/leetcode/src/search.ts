import { Database } from "bun:sqlite";
import { SearchDb } from "./lib/search-db.ts";
import { EmbeddingClient } from "./lib/embeddings.ts";
import { SQLITE_PATH } from "./lib/config.ts";
import type { FtsResult, VectorResult } from "./lib/search-db.ts";

type SearchResult = {
  slug: string;
  title: string;
  difficulty: string;
  tags: string[];
  score: number;
  snippet: string;
  source: "keyword" | "semantic" | "hybrid";
};

function parseArgs(): { query: string; mode: "hybrid" | "semantic" | "keyword"; limit: number } {
  const args = process.argv.slice(2);
  let mode: "hybrid" | "semantic" | "keyword" = "hybrid";
  let limit = 10;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--semantic") mode = "semantic";
    else if (args[i] === "--keyword") mode = "keyword";
    else if (args[i] === "--hybrid") mode = "hybrid";
    else if (args[i] === "--limit" && args[i + 1]) { limit = parseInt(args[++i]); }
    else queryParts.push(args[i]);
  }

  const query = queryParts.join(" ");
  if (!query) {
    console.error("Usage: bun run search <query> [--semantic|--keyword|--hybrid] [--limit N]");
    process.exit(1);
  }
  return { query, mode, limit };
}

function rrfMerge(
  ftsResults: Array<{ slug: string; rank: number }>,
  vectorResults: Array<{ slug: string; text: string; distance: number }>,
  k: number = 60,
): Map<string, { score: number; snippet: string }> {
  const scores = new Map<string, { score: number; snippet: string }>();

  // FTS results (already sorted by rank, lower = better)
  for (let i = 0; i < ftsResults.length; i++) {
    const slug = ftsResults[i].slug;
    const rrf = 1 / (k + i + 1);
    const existing = scores.get(slug);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(slug, { score: rrf, snippet: "" });
    }
  }

  // Vector results (sorted by distance, lower = better)
  for (let i = 0; i < vectorResults.length; i++) {
    const slug = vectorResults[i].slug;
    const rrf = 1 / (k + i + 1);
    const existing = scores.get(slug);
    if (existing) {
      existing.score += rrf;
      if (!existing.snippet) existing.snippet = vectorResults[i].text;
    } else {
      scores.set(slug, { score: rrf, snippet: vectorResults[i].text });
    }
  }

  return scores;
}

async function main() {
  const { query, mode, limit } = parseArgs();
  const searchDb = new SearchDb(SQLITE_PATH);
  const sourceDb = new Database(SQLITE_PATH, { readonly: true });

  let ftsResults: FtsResult[] = [];
  let vectorResults: VectorResult[] = [];
  let embedder: EmbeddingClient | null = null;

  // FTS search
  if (mode === "keyword" || mode === "hybrid") {
    try {
      ftsResults = searchDb.searchFts(query, 30);
    } catch {
      // FTS might not be built yet
    }
  }

  // Vector search
  if (mode === "semantic" || mode === "hybrid") {
    embedder = new EmbeddingClient();
    if (await embedder.isAvailable()) {
      try {
        const [queryVector] = await embedder.embed([query]);
        vectorResults = await searchDb.vectorSearch(queryVector, 30);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[vector search error] ${msg}`);
      }
    } else if (mode === "semantic") {
      console.error("Embedding model not available. Use --keyword mode instead.");
      process.exit(1);
    }
  }

  // Merge results
  let results: SearchResult[];

  if (mode === "keyword") {
    results = ftsResults.map((r) => ({
      slug: r.slug,
      title: r.title,
      difficulty: "",
      tags: [],
      score: -r.rank,
      snippet: "",
      source: "keyword" as const,
    }));
  } else if (mode === "semantic") {
    // Deduplicate by slug, keep best
    const seen = new Map<string, VectorResult>();
    for (const r of vectorResults) {
      if (!seen.has(r.problem_slug) || r._distance < seen.get(r.problem_slug)!._distance) {
        seen.set(r.problem_slug, r);
      }
    }
    results = Array.from(seen.values()).map((r) => ({
      slug: r.problem_slug,
      title: "",
      difficulty: "",
      tags: [],
      score: 1 / (1 + r._distance),
      snippet: r.text.substring(0, 150),
      source: "semantic" as const,
    }));
  } else {
    // Hybrid RRF
    const merged = rrfMerge(
      ftsResults.map((r) => ({ slug: r.slug, rank: r.rank })),
      vectorResults.map((r) => ({ slug: r.problem_slug, text: r.text, distance: r._distance })),
    );
    results = Array.from(merged.entries()).map(([slug, { score, snippet }]) => ({
      slug,
      title: "",
      difficulty: "",
      tags: [],
      score,
      snippet: snippet.substring(0, 150),
      source: "hybrid" as const,
    }));
  }

  // Sort by score descending and limit
  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  // Enrich with metadata
  for (const result of results) {
    const problem = sourceDb.query(
      "SELECT title, difficulty FROM problems WHERE slug = ?",
    ).get(result.slug) as { title: string; difficulty: string } | null;
    if (problem) {
      result.title = problem.title;
      result.difficulty = problem.difficulty;
    }
    const tags = sourceDb.query(`
      SELECT t.name FROM topic_tags t
      JOIN problem_tags pt ON pt.tag_id = t.id
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug = ?
    `).all(result.slug) as { name: string }[];
    result.tags = tags.map((t) => t.name);
  }

  // Display
  if (results.length === 0) {
    console.log("No results found.");
  } else {
    console.log(`\n${results.length} results for "${query}" (${mode} mode):\n`);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const diffColor = r.difficulty === "Easy" ? "\x1b[32m" : r.difficulty === "Medium" ? "\x1b[33m" : "\x1b[31m";
      console.log(`  ${i + 1}. ${r.title} ${diffColor}[${r.difficulty}]\x1b[0m`);
      console.log(`     Tags: ${r.tags.join(", ") || "none"}`);
      console.log(`     https://leetcode.com/problems/${r.slug}/`);
      if (r.snippet) {
        console.log(`     ${r.snippet.replace(/\n/g, " ").substring(0, 120)}...`);
      }
      console.log();
    }
  }

  if (embedder) embedder.shutdown();
  searchDb.close();
  sourceDb.close();
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
