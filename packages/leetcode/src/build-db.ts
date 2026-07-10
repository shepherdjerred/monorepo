import { Database } from "bun:sqlite";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { formatDuration, timestamp } from "./lib/format.ts";

const DATA_DIR = new URL("../data", import.meta.url).pathname;
const PROBLEMS_DIR = path.join(DATA_DIR, "problems");
const DB_PATH = path.join(DATA_DIR, "leetcode.db");

const QuestionSchema = z.object({
  questionId: z.coerce.number(),
  questionFrontendId: z.string().default(""),
  title: z.string().default(""),
  titleSlug: z.string().default(""),
  difficulty: z.string().default(""),
  isPaidOnly: z.boolean().default(false),
  likes: z.coerce.number().default(0),
  dislikes: z.coerce.number().default(0),
  content: z.string().nullish(),
  hints: z.unknown().nullish(),
  exampleTestcaseList: z.unknown().nullish(),
  metaData: z.string().nullish(),
  stats: z.string().nullish(),
  similarQuestions: z.string().nullish(),
  topicTags: z
    .array(z.object({ name: z.string(), slug: z.string() }))
    .nullish(),
  codeSnippets: z
    .array(
      z.object({ lang: z.string(), langSlug: z.string(), code: z.string() }),
    )
    .nullish(),
  solution: z
    .object({
      content: z.string().nullable(),
      canSeeDetail: z.boolean(),
      paidOnly: z.boolean(),
    })
    .nullish(),
  companyTagStatsV2: z.string().nullish(),
});

type Question = z.infer<typeof QuestionSchema>;

const CompanyStatsSchema = z.record(
  z.string(),
  z.array(
    z.object({
      taggedByAdmin: z.boolean(),
      name: z.string(),
      slug: z.string(),
      timesEncountered: z.number(),
    }),
  ),
);

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY,
      frontend_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      difficulty TEXT NOT NULL,
      paid_only INTEGER NOT NULL DEFAULT 0,
      ac_rate REAL,
      likes INTEGER,
      dislikes INTEGER,
      content_html TEXT,
      hints_json TEXT,
      example_testcases TEXT,
      meta_data TEXT,
      stats TEXT,
      similar_questions TEXT
    );

    CREATE TABLE IF NOT EXISTS topic_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS problem_tags (
      problem_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (problem_id, tag_id),
      FOREIGN KEY (problem_id) REFERENCES problems(id),
      FOREIGN KEY (tag_id) REFERENCES topic_tags(id)
    );

    CREATE TABLE IF NOT EXISTS code_snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL,
      lang TEXT NOT NULL,
      lang_slug TEXT NOT NULL,
      code TEXT NOT NULL,
      FOREIGN KEY (problem_id) REFERENCES problems(id)
    );

    CREATE TABLE IF NOT EXISTS editorials (
      problem_id INTEGER PRIMARY KEY,
      content_html TEXT,
      can_see_detail INTEGER,
      paid_only INTEGER,
      FOREIGN KEY (problem_id) REFERENCES problems(id)
    );

    CREATE TABLE IF NOT EXISTS company_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL,
      company TEXT NOT NULL,
      frequency REAL,
      time_period TEXT,
      FOREIGN KEY (problem_id) REFERENCES problems(id)
    );

    CREATE INDEX IF NOT EXISTS idx_problems_slug ON problems(slug);
    CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
    CREATE INDEX IF NOT EXISTS idx_problems_frontend_id ON problems(frontend_id);
    CREATE INDEX IF NOT EXISTS idx_code_snippets_problem ON code_snippets(problem_id);
    CREATE INDEX IF NOT EXISTS idx_company_tags_problem ON company_tags(problem_id);
    CREATE INDEX IF NOT EXISTS idx_company_tags_company ON company_tags(company);
  `);
}

type Statements = ReturnType<typeof prepareStatements>;

function prepareStatements(db: Database) {
  return {
    insertProblem: db.prepare(`
      INSERT OR REPLACE INTO problems (id, frontend_id, title, slug, difficulty, paid_only, ac_rate, likes, dislikes, content_html, hints_json, example_testcases, meta_data, stats, similar_questions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertTag: db.prepare(
      `INSERT OR IGNORE INTO topic_tags (name, slug) VALUES (?, ?)`,
    ),
    getTagId: db.prepare<{ id: number }, [string]>(
      `SELECT id FROM topic_tags WHERE slug = ?`,
    ),
    insertProblemTag: db.prepare(
      `INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)`,
    ),
    insertSnippet: db.prepare(
      `INSERT INTO code_snippets (problem_id, lang, lang_slug, code) VALUES (?, ?, ?, ?)`,
    ),
    insertEditorial: db.prepare(
      `INSERT OR REPLACE INTO editorials (problem_id, content_html, can_see_detail, paid_only) VALUES (?, ?, ?, ?)`,
    ),
    insertCompanyTag: db.prepare(
      `INSERT INTO company_tags (problem_id, company, frequency, time_period) VALUES (?, ?, ?, ?)`,
    ),
  };
}

function insertTags(stmts: Statements, q: Question): void {
  if (!q.topicTags) return;
  for (const tag of q.topicTags) {
    stmts.insertTag.run(tag.name, tag.slug);
    const row = stmts.getTagId.get(tag.slug);
    if (row != null) {
      stmts.insertProblemTag.run(q.questionId, row.id);
    }
  }
}

function insertCompanyTags(stmts: Statements, q: Question): void {
  if (q.companyTagStatsV2 == null || q.companyTagStatsV2 === "") return;
  const parsed = CompanyStatsSchema.safeParse(JSON.parse(q.companyTagStatsV2));
  if (!parsed.success) return; // Some company data might be malformed.
  for (const [timePeriod, companies] of Object.entries(parsed.data)) {
    for (const company of companies) {
      stmts.insertCompanyTag.run(
        q.questionId,
        company.name,
        company.timesEncountered,
        timePeriod,
      );
    }
  }
}

function insertQuestion(stmts: Statements, q: Question): void {
  stmts.insertProblem.run(
    q.questionId,
    q.questionFrontendId,
    q.title,
    q.titleSlug,
    q.difficulty,
    q.isPaidOnly ? 1 : 0,
    null, // ac_rate not in detail response
    q.likes,
    q.dislikes,
    q.content ?? null,
    q.hints == null ? null : JSON.stringify(q.hints),
    q.exampleTestcaseList == null
      ? null
      : JSON.stringify(q.exampleTestcaseList),
    q.metaData ?? null,
    q.stats ?? null,
    q.similarQuestions ?? null,
  );

  insertTags(stmts, q);

  if (q.codeSnippets) {
    for (const s of q.codeSnippets) {
      stmts.insertSnippet.run(q.questionId, s.lang, s.langSlug, s.code);
    }
  }

  if (q.solution) {
    stmts.insertEditorial.run(
      q.questionId,
      q.solution.content ?? null,
      q.solution.canSeeDetail ? 1 : 0,
      q.solution.paidOnly ? 1 : 0,
    );
  }

  insertCompanyTags(stmts, q);
}

async function main() {
  const startTime = Date.now();
  console.log(`[${timestamp()}] Building SQLite database...`);

  const entries = await readdir(PROBLEMS_DIR);
  const files = entries.filter((f) => f.endsWith(".json"));
  console.log(`[${timestamp()}] Found ${String(files.length)} problem files`);

  // Read every problem file up front so the SQLite write transaction stays sync.
  const documents = await Promise.all(
    files.map(async (file) => {
      const json: unknown = await Bun.file(
        path.join(PROBLEMS_DIR, file),
      ).json();
      return { file, json };
    }),
  );

  // Remove existing DB
  const dbFile = Bun.file(DB_PATH);
  if (dbFile.size > 0) {
    await unlink(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  createSchema(db);

  const stmts = prepareStatements(db);

  let count = 0;
  let errors = 0;

  const insertAll = db.transaction(() => {
    for (const { file, json } of documents) {
      try {
        const q = QuestionSchema.parse(json);
        insertQuestion(stmts, q);
        count++;
        if (count % 500 === 0) {
          console.log(
            `[${timestamp()}] Processed ${String(count)}/${String(files.length)} problems`,
          );
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[${timestamp()}] Error processing ${file}: ${msg}`);
        errors++;
      }
    }
  });

  insertAll();

  db.close();

  const elapsed = formatDuration(Date.now() - startTime);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${timestamp()}] Database build complete`);
  console.log(`  Problems: ${String(count)}`);
  console.log(`  Errors:   ${String(errors)}`);
  console.log(`  Output:   ${DB_PATH}`);
  console.log(`  Elapsed:  ${elapsed}`);
  console.log("=".repeat(60));
}

try {
  await main();
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n[FATAL] ${msg}`);
  process.exit(1);
}
