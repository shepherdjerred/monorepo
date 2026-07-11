import { Database } from "bun:sqlite";
import { SearchDb } from "./lib/search-db.ts";
import { EmbeddingClient } from "./lib/embeddings.ts";
import { SQLITE_PATH } from "./lib/config.ts";

type SearchMode = "semantic" | "keyword" | "hybrid";

type SearchResult = {
  slug: string;
  title: string;
  difficulty: string;
  tags: string[];
  score: number;
};

function parseArgs(): { query: string; mode: SearchMode; limit: number } {
  const args = process.argv.slice(2);
  let mode: SearchMode = "semantic";
  let limit = 10;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--semantic": {
        mode = "semantic";
        break;
      }
      case "--keyword": {
        mode = "keyword";
        break;
      }
      case "--hybrid": {
        mode = "hybrid";
        break;
      }
      case "--limit": {
        if (args[i + 1] !== undefined) {
          limit = Number.parseInt(args[++i] ?? "10");
        }
        break;
      }
      default: {
        queryParts.push(arg);
      }
    }
  }

  const query = queryParts.join(" ");
  if (query === "") {
    console.error(
      "Usage: bun run search <query> [--semantic|--keyword|--hybrid] [--limit N]",
    );
    process.exit(1);
  }
  return { query, mode, limit };
}

function keywordSearch(
  searchDb: SearchDb,
  query: string,
  limit: number,
): SearchResult[] {
  return searchDb.searchFts(query, limit).map((r) => ({
    slug: r.slug,
    title: r.title,
    difficulty: "",
    tags: [],
    score: -r.rank,
  }));
}

async function semanticSearch(
  searchDb: SearchDb,
  embedder: EmbeddingClient,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  if (!(await embedder.isAvailable())) {
    console.error("Embedding model not available. Use --keyword mode.");
    process.exit(1);
  }
  const embedResult = await embedder.embed([query]);
  const queryVector = embedResult[0];
  if (!queryVector) {
    console.error("Failed to generate embedding for query.");
    process.exit(1);
  }
  return searchDb
    .vectorSearch(new Float32Array(queryVector), limit)
    .map((r) => ({
      slug: r.slug,
      title: "",
      difficulty: "",
      tags: [],
      score: r.score,
    }));
}

async function hybridSearch(
  searchDb: SearchDb,
  embedder: EmbeddingClient,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const fts = searchDb.searchFts(query, 30);
  let vectorResults: { slug: string; score: number }[] = [];

  if (await embedder.isAvailable()) {
    const embedResult = await embedder.embed([query]);
    const queryVector = embedResult[0];
    if (queryVector) {
      vectorResults = searchDb.vectorSearch(new Float32Array(queryVector), 30);
    }
  }

  // RRF merge (k=60)
  const K = 60;
  const scores = new Map<string, number>();
  for (const [i, ftsItem] of fts.entries()) {
    scores.set(ftsItem.slug, (scores.get(ftsItem.slug) ?? 0) + 1 / (K + i + 1));
  }
  for (const [i, vecItem] of vectorResults.entries()) {
    scores.set(vecItem.slug, (scores.get(vecItem.slug) ?? 0) + 1 / (K + i + 1));
  }

  return [...scores.entries()]
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

type ProblemMeta = { title: string; difficulty: string };
type TagRow = { name: string };

function enrichResults(sourceDb: Database, results: SearchResult[]): void {
  for (const result of results) {
    const problem = sourceDb
      .query<
        ProblemMeta,
        [string]
      >("SELECT title, difficulty FROM problems WHERE slug = ?")
      .get(result.slug);
    if (problem) {
      result.title = problem.title;
      result.difficulty = problem.difficulty;
    }
    const tags = sourceDb
      .query<TagRow, [string]>(
        `
      SELECT t.name FROM topic_tags t
      JOIN problem_tags pt ON pt.tag_id = t.id
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug = ?
    `,
      )
      .all(result.slug);
    result.tags = tags.map((t) => t.name);
  }
}

function difficultyColor(difficulty: string): string {
  if (difficulty === "Easy") return "\u001B[32m";
  if (difficulty === "Medium") return "\u001B[33m";
  return "\u001B[31m";
}

function displayResults(
  results: SearchResult[],
  query: string,
  mode: SearchMode,
): void {
  if (results.length === 0) {
    console.log("No results found.");
    return;
  }
  console.log(
    `\n${String(results.length)} results for "${query}" (${mode} mode):\n`,
  );
  for (const [i, r] of results.entries()) {
    const dc = difficultyColor(r.difficulty);
    console.log(
      `  ${String(i + 1)}. ${r.title} ${dc}[${r.difficulty}]\u001B[0m  (${r.score.toFixed(4)})`,
    );
    console.log(`     Tags: ${r.tags.join(", ") || "none"}`);
    console.log(`     https://leetcode.com/problems/${r.slug}/`);
    console.log();
  }
}

async function main() {
  const { query, mode, limit } = parseArgs();
  const searchDb = new SearchDb(SQLITE_PATH);
  const sourceDb = new Database(SQLITE_PATH, { readonly: true });
  let embedder: EmbeddingClient | null = null;

  let results: SearchResult[];
  if (mode === "keyword") {
    results = keywordSearch(searchDb, query, limit);
  } else if (mode === "semantic") {
    embedder = new EmbeddingClient();
    results = await semanticSearch(searchDb, embedder, query, limit);
  } else {
    embedder = new EmbeddingClient();
    results = await hybridSearch(searchDb, embedder, query, limit);
  }

  enrichResults(sourceDb, results);
  displayResults(results, query, mode);

  if (embedder) embedder.shutdown();
  searchDb.close();
  sourceDb.close();
  process.exit(0);
}

try {
  await main();
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n[FATAL] ${msg}`);
  process.exit(1);
}
