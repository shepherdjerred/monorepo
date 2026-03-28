import { Database } from "bun:sqlite";
import { SQLITE_PATH } from "./config.ts";

export type VectorResult = {
  slug: string;
  score: number;
};

export type FtsResult = {
  slug: string;
  title: string;
  rank: number;
  snippet: string;
};

export class SearchDb {
  private db: Database;
  private vectorCache: { slugs: string[]; vectors: Float32Array[] } | null =
    null;

  constructor(sqlitePath: string = SQLITE_PATH) {
    this.db = new Database(sqlitePath);
    this.db.exec("PRAGMA journal_mode = WAL");
  }

  createSchema(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS problems_fts USING fts5(
        slug UNINDEXED,
        title,
        tags,
        description,
        constraints,
        editorial,
        tokenize='porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS problem_vectors (
        problem_slug TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        text_embedded TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_index_meta (
        problem_slug TEXT PRIMARY KEY,
        indexed_at TEXT NOT NULL
      );
    `);
  }

  isIndexed(slug: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM search_index_meta WHERE problem_slug = ?")
        .get(slug) != null
    );
  }

  hasVector(slug: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM problem_vectors WHERE problem_slug = ?")
        .get(slug) != null
    );
  }

  addToFts(
    slug: string,
    title: string,
    tags: string,
    description: string,
    constraints: string,
    editorial: string,
  ): void {
    this.db
      .query(
        "INSERT OR REPLACE INTO problems_fts (slug, title, tags, description, constraints, editorial) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(slug, title, tags, description, constraints, editorial);
    this.db
      .query(
        "INSERT OR REPLACE INTO search_index_meta (problem_slug, indexed_at) VALUES (?, ?)",
      )
      .run(slug, new Date().toISOString());
  }

  addVector(slug: string, vector: Float32Array, textEmbedded: string): void {
    const blob = Buffer.from(vector.buffer);
    this.db
      .query(
        "INSERT OR REPLACE INTO problem_vectors (problem_slug, vector, text_embedded) VALUES (?, ?, ?)",
      )
      .run(slug, blob, textEmbedded);
  }

  private loadVectorCache(): { slugs: string[]; vectors: Float32Array[] } {
    if (this.vectorCache) return this.vectorCache;
    const rows = this.db
      .query("SELECT problem_slug, vector FROM problem_vectors")
      .all() as Array<{
      problem_slug: string;
      vector: Buffer;
    }>;
    const slugs: string[] = [];
    const vectors: Float32Array[] = [];
    for (const row of rows) {
      slugs.push(row.problem_slug);
      vectors.push(
        new Float32Array(
          row.vector.buffer,
          row.vector.byteOffset,
          row.vector.byteLength / 4,
        ),
      );
    }
    this.vectorCache = { slugs, vectors };
    return this.vectorCache;
  }

  vectorSearch(queryVector: Float32Array, limit: number = 50): VectorResult[] {
    const { slugs, vectors } = this.loadVectorCache();
    const results: VectorResult[] = [];
    for (let i = 0; i < vectors.length; i++) {
      results.push({
        slug: slugs[i],
        score: dotProduct(queryVector, vectors[i]),
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  searchFts(query: string, limit: number = 30): FtsResult[] {
    const matchExpr = buildFtsQuery(query);
    return this.db
      .query(
        `SELECT slug, title, bm25(problems_fts, 0, 50, 3, 1, 0, 0) as rank,
         snippet(problems_fts, 3, '', '', '...', 20) as snippet
         FROM problems_fts WHERE problems_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(matchExpr, limit) as FtsResult[];
  }

  getDb(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function buildFtsQuery(query: string): string {
  // Sanitize: remove FTS5 special chars except quotes
  const clean = query.replace(/[{}()[\]:^~*]/g, "").trim();
  if (!clean) return query;

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return query;

  // Phrase match + title-scoped match
  const phrase = `"${clean}"`;
  const titleScoped = words.map((w) => `title:${w}`).join(" AND ");
  return `${phrase} OR (${titleScoped})`;
}
