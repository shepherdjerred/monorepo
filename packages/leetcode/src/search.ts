import { Database } from "bun:sqlite";
import { SearchDb } from "./lib/search-db.ts";
import { EmbeddingClient } from "./lib/embeddings.ts";
import { SQLITE_PATH } from "./lib/config.ts";

type SearchResult = {
  slug: string;
  title: string;
  difficulty: string;
  tags: string[];
  score: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let mode: "semantic" | "keyword" | "hybrid" = "semantic";
  let limit = 10;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--semantic") mode = "semantic";
    else if (args[i] === "--keyword") mode = "keyword";
    else if (args[i] === "--hybrid") mode = "hybrid";
    else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i]);
    else queryParts.push(args[i]);
  }

  const query = queryParts.join(" ");
  if (!query) {
    console.error(
      "Usage: bun run search <query> [--semantic|--keyword|--hybrid] [--limit N]",
    );
    process.exit(1);
  }
  return { query, mode, limit };
}

async function main() {
  const { query, mode, limit } = parseArgs();
  const searchDb = new SearchDb(SQLITE_PATH);
  const sourceDb = new Database(SQLITE_PATH, { readonly: true });
  let embedder: EmbeddingClient | null = null;

  let results: SearchResult[] = [];

  if (mode === "keyword") {
    const fts = searchDb.searchFts(query, limit);
    results = fts.map((r) => ({
      slug: r.slug,
      title: r.title,
      difficulty: "",
      tags: [],
      score: -r.rank,
    }));
  } else if (mode === "semantic") {
    embedder = new EmbeddingClient();
    if (!(await embedder.isAvailable())) {
      console.error("Embedding model not available. Use --keyword mode.");
      process.exit(1);
    }
    const [queryVector] = await embedder.embed([query]);
    const vectorResults = searchDb.vectorSearch(
      new Float32Array(queryVector),
      limit,
    );
    results = vectorResults.map((r) => ({
      slug: r.slug,
      title: "",
      difficulty: "",
      tags: [],
      score: r.score,
    }));
  } else {
    // Hybrid: RRF of semantic + keyword
    embedder = new EmbeddingClient();
    const fts = searchDb.searchFts(query, 30);
    let vectorResults: Array<{ slug: string; score: number }> = [];

    if (await embedder.isAvailable()) {
      const [queryVector] = await embedder.embed([query]);
      vectorResults = searchDb.vectorSearch(new Float32Array(queryVector), 30);
    }

    // RRF merge (k=60)
    const K = 60;
    const scores = new Map<string, number>();
    for (let i = 0; i < fts.length; i++) {
      scores.set(fts[i].slug, (scores.get(fts[i].slug) ?? 0) + 1 / (K + i + 1));
    }
    for (let i = 0; i < vectorResults.length; i++) {
      scores.set(
        vectorResults[i].slug,
        (scores.get(vectorResults[i].slug) ?? 0) + 1 / (K + i + 1),
      );
    }

    results = Array.from(scores.entries())
      .map(([slug, score]) => ({
        slug,
        title: "",
        difficulty: "",
        tags: [],
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Enrich with metadata
  for (const result of results) {
    const problem = sourceDb
      .query("SELECT title, difficulty FROM problems WHERE slug = ?")
      .get(result.slug) as { title: string; difficulty: string } | null;
    if (problem) {
      result.title = problem.title;
      result.difficulty = problem.difficulty;
    }
    const tags = sourceDb
      .query(
        `
      SELECT t.name FROM topic_tags t
      JOIN problem_tags pt ON pt.tag_id = t.id
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug = ?
    `,
      )
      .all(result.slug) as { name: string }[];
    result.tags = tags.map((t) => t.name);
  }

  // Display
  if (results.length === 0) {
    console.log("No results found.");
  } else {
    console.log(`\n${results.length} results for "${query}" (${mode} mode):\n`);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const dc =
        r.difficulty === "Easy"
          ? "\x1b[32m"
          : r.difficulty === "Medium"
            ? "\x1b[33m"
            : "\x1b[31m";
      console.log(
        `  ${i + 1}. ${r.title} ${dc}[${r.difficulty}]\x1b[0m  (${r.score.toFixed(4)})`,
      );
      console.log(`     Tags: ${r.tags.join(", ") || "none"}`);
      console.log(`     https://leetcode.com/problems/${r.slug}/`);
      console.log();
    }
  }

  if (embedder) embedder.shutdown();
  searchDb.close();
  sourceDb.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
