import { Database } from "bun:sqlite";
import { readdirSync } from "fs";
import { join } from "path";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const DATA_DIR = new URL("../data", import.meta.url).pathname;
const PROBLEMS_DIR = join(DATA_DIR, "problems");
const DB_PATH = join(DATA_DIR, "leetcode.db");

function createSchema(db: Database) {
  db.exec(`
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

function main() {
  const startTime = Date.now();
  console.log(`[${timestamp()}] Building SQLite database...`);

  const files = readdirSync(PROBLEMS_DIR).filter((f) => f.endsWith(".json"));
  console.log(`[${timestamp()}] Found ${files.length} problem files`);

  // Remove existing DB
  const dbFile = Bun.file(DB_PATH);
  if (dbFile.size > 0) {
    const { unlinkSync } = require("fs");
    unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  createSchema(db);

  // Prepared statements
  const insertProblem = db.prepare(`
    INSERT OR REPLACE INTO problems (id, frontend_id, title, slug, difficulty, paid_only, ac_rate, likes, dislikes, content_html, hints_json, example_testcases, meta_data, stats, similar_questions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO topic_tags (name, slug) VALUES (?, ?)`,
  );
  const getTagId = db.prepare(`SELECT id FROM topic_tags WHERE slug = ?`);
  const insertProblemTag = db.prepare(
    `INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)`,
  );
  const insertSnippet = db.prepare(
    `INSERT INTO code_snippets (problem_id, lang, lang_slug, code) VALUES (?, ?, ?, ?)`,
  );
  const insertEditorial = db.prepare(
    `INSERT OR REPLACE INTO editorials (problem_id, content_html, can_see_detail, paid_only) VALUES (?, ?, ?, ?)`,
  );
  const insertCompanyTag = db.prepare(
    `INSERT INTO company_tags (problem_id, company, frequency, time_period) VALUES (?, ?, ?, ?)`,
  );

  let count = 0;
  let errors = 0;

  const insertAll = db.transaction(() => {
    for (const file of files) {
      try {
        // Bun.file().json() returns a promise in some contexts, but in sync transaction we need sync read
        const text = require("fs").readFileSync(
          join(PROBLEMS_DIR, file),
          "utf-8",
        );
        const q = JSON.parse(text) as Record<string, unknown>;

        const questionId = Number(q["questionId"]);
        const frontendId = String(q["questionFrontendId"] ?? "");
        const title = String(q["title"] ?? "");
        const slug = String(q["titleSlug"] ?? "");
        const difficulty = String(q["difficulty"] ?? "");
        const paidOnly = q["isPaidOnly"] ? 1 : 0;
        const likes = Number(q["likes"] ?? 0);
        const dislikes = Number(q["dislikes"] ?? 0);
        const content = q["content"] ? String(q["content"]) : null;
        const hints = q["hints"] ? JSON.stringify(q["hints"]) : null;
        const exampleTestcases = q["exampleTestcaseList"]
          ? JSON.stringify(q["exampleTestcaseList"])
          : null;
        const metaData = q["metaData"] ? String(q["metaData"]) : null;
        const stats = q["stats"] ? String(q["stats"]) : null;
        const similarQuestions = q["similarQuestions"]
          ? String(q["similarQuestions"])
          : null;

        insertProblem.run(
          questionId,
          frontendId,
          title,
          slug,
          difficulty,
          paidOnly,
          null, // ac_rate not in detail response
          likes,
          dislikes,
          content,
          hints,
          exampleTestcases,
          metaData,
          stats,
          similarQuestions,
        );

        // Topic tags
        const topicTags = q["topicTags"] as Array<{
          name: string;
          slug: string;
        }> | null;
        if (topicTags) {
          for (const tag of topicTags) {
            insertTag.run(tag.name, tag.slug);
            const row = getTagId.get(tag.slug) as { id: number };
            insertProblemTag.run(questionId, row.id);
          }
        }

        // Code snippets
        const snippets = q["codeSnippets"] as Array<{
          lang: string;
          langSlug: string;
          code: string;
        }> | null;
        if (snippets) {
          for (const s of snippets) {
            insertSnippet.run(questionId, s.lang, s.langSlug, s.code);
          }
        }

        // Editorial
        const solution = q["solution"] as {
          content: string | null;
          canSeeDetail: boolean;
          paidOnly: boolean;
        } | null;
        if (solution) {
          insertEditorial.run(
            questionId,
            solution.content ?? null,
            solution.canSeeDetail ? 1 : 0,
            solution.paidOnly ? 1 : 0,
          );
        }

        // Company tags
        if (
          q["companyTagStatsV2"] &&
          typeof q["companyTagStatsV2"] === "string"
        ) {
          try {
            const companyData = JSON.parse(q["companyTagStatsV2"]) as Record<
              string,
              Array<{
                taggedByAdmin: boolean;
                name: string;
                slug: string;
                timesEncountered: number;
              }>
            >;
            for (const [timePeriod, companies] of Object.entries(companyData)) {
              for (const company of companies) {
                insertCompanyTag.run(
                  questionId,
                  company.name,
                  company.timesEncountered,
                  timePeriod,
                );
              }
            }
          } catch {
            // Some company data might be malformed
          }
        }

        count++;
        if (count % 500 === 0) {
          console.log(
            `[${timestamp()}] Processed ${count}/${files.length} problems`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
  console.log(`  Problems: ${count}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Output:   ${DB_PATH}`);
  console.log(`  Elapsed:  ${elapsed}`);
  console.log("=".repeat(60));
}

main();
