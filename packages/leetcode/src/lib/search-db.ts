import { Database } from "bun:sqlite";
import { connect, type Table, type Connection } from "@lancedb/lancedb";
import { mkdirSync, existsSync } from "fs";
import { SQLITE_PATH, LANCE_DIR, EMBEDDING_DIM } from "./config.ts";

export type ChunkRow = {
  id: string;
  problem_slug: string;
  section: string;
  chunk_index: number;
  text: string;
  vector: number[];
};

export type FtsResult = {
  slug: string;
  title: string;
  rank: number;
};

export type VectorResult = {
  problem_slug: string;
  section: string;
  text: string;
  _distance: number;
};

export class SearchDb {
  private db: Database;
  private lance: Connection | null = null;
  private table: Table | null = null;

  constructor(sqlitePath: string = SQLITE_PATH) {
    this.db = new Database(sqlitePath);
    this.db.exec("PRAGMA journal_mode = WAL");
  }

  createFtsSchema(): void {
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
    `);
    // Track which problems have been indexed for resumability
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_index_meta (
        problem_slug TEXT PRIMARY KEY,
        indexed_at TEXT NOT NULL
      );
    `);
  }

  isIndexed(slug: string): boolean {
    const row = this.db.query("SELECT 1 FROM search_index_meta WHERE problem_slug = ?").get(slug);
    return row != null;
  }

  addToFts(slug: string, title: string, tags: string, description: string, constraints: string, editorial: string): void {
    this.db.query(
      "INSERT OR REPLACE INTO problems_fts (slug, title, tags, description, constraints, editorial) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(slug, title, tags, description, constraints, editorial);
    this.db.query(
      "INSERT OR REPLACE INTO search_index_meta (problem_slug, indexed_at) VALUES (?, ?)",
    ).run(slug, new Date().toISOString());
  }

  searchFts(query: string, limit: number = 30): FtsResult[] {
    return this.db
      .query(
        `SELECT slug, title, rank FROM problems_fts WHERE problems_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as FtsResult[];
  }

  async ensureLance(): Promise<Table> {
    if (this.table) return this.table;
    if (!existsSync(LANCE_DIR)) mkdirSync(LANCE_DIR, { recursive: true });
    this.lance = await connect(LANCE_DIR);
    const tableNames = await this.lance.tableNames();
    if (tableNames.includes("leetcode_chunks")) {
      this.table = await this.lance.openTable("leetcode_chunks");
    } else {
      // LanceDB requires at least one row to infer schema — create with dummy then delete
      this.table = await this.lance.createTable("leetcode_chunks", [
        {
          id: "__init__",
          problem_slug: "",
          section: "",
          chunk_index: 0,
          text: "",
          vector: Array.from<number>({ length: EMBEDDING_DIM }).fill(0),
        },
      ]);
      await this.table.delete('id = "__init__"');
    }
    return this.table;
  }

  async addChunks(chunks: ChunkRow[]): Promise<void> {
    const table = await this.ensureLance();
    await table.add(chunks);
  }

  async vectorSearch(queryVector: number[], limit: number = 30): Promise<VectorResult[]> {
    const table = await this.ensureLance();
    const results = await table.search(queryVector).limit(limit).toArray();
    return results as unknown as VectorResult[];
  }

  getDb(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
