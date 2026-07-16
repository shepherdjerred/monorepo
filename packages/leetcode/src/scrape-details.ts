import { appendFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CloudflareBlockError,
  LeetCodeClient,
} from "./lib/leetcode-graphql.ts";
import { formatDuration, timestamp } from "./lib/format.ts";

const ProblemListSchema = z.array(z.object({ titleSlug: z.string() }));
const QuestionResponseSchema = z.object({
  question: z.unknown().nullable(),
});

const DATA_DIR = new URL("../data", import.meta.url).pathname;
const PROBLEMS_DIR = path.join(DATA_DIR, "problems");
const LIST_PATH = path.join(DATA_DIR, "problems-list.json");
const ERROR_LOG_PATH = path.join(DATA_DIR, "errors.log");

async function readJsonFilenames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((file) => file.endsWith(".json"));
  } catch (error: unknown) {
    // Directory does not exist yet on the first run — nothing fetched.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

const DETAIL_QUERY = `
query getQuestionDetail($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    difficulty
    content
    hints
    metaData
    stats
    likes
    dislikes
    isPaidOnly
    similarQuestions
    exampleTestcaseList
    companyTagStatsV2
    topicTags { name slug }
    codeSnippets { lang langSlug code }
    solution { id content canSeeDetail paidOnly }
  }
}`;

let shuttingDown = false;
const stats = { ok: 0, skipped: 0, errors: 0 };

async function appendErrorLog(slug: string, message: string) {
  const line = `[${timestamp()}] ${slug}: ${message}\n`;
  await appendFile(ERROR_LOG_PATH, line);
}

function printProgress(current: number, total: number, startTime: number) {
  const pct = ((current / total) * 100).toFixed(1);
  const elapsed = Date.now() - startTime;
  const rate = current / (elapsed / 1000);
  const remaining = (total - current) / rate;
  const eta = formatDuration(remaining * 1000);
  console.log(
    `\n[Progress] ${String(current)}/${String(total)} (${pct}%) | ${String(stats.ok)} ok, ${String(stats.skipped)} skip, ${String(stats.errors)} err | ${formatDuration(elapsed)} elapsed | eta ${eta}\n`,
  );
}

async function main() {
  if (!(await Bun.file(LIST_PATH).exists())) {
    console.error(
      `Problem list not found at ${LIST_PATH}. Run scrape:list first.`,
    );
    process.exit(1);
  }

  const problemList = ProblemListSchema.parse(await Bun.file(LIST_PATH).json());
  console.log(
    `[${timestamp()}] Loaded ${String(problemList.length)} problems from list`,
  );

  // Scan existing files for resume
  const existing = new Set<string>();
  for (const file of await readJsonFilenames(PROBLEMS_DIR)) {
    existing.add(file.replace(".json", ""));
  }
  console.log(
    `[${timestamp()}] Found ${String(existing.size)} already fetched — will skip those`,
  );

  const toFetch = problemList.filter((p) => !existing.has(p.titleSlug));
  const total = problemList.length;
  let current = existing.size;
  stats.skipped = existing.size;

  console.log(
    `[${timestamp()}] Fetching ${String(toFetch.length)} remaining problems...\n`,
  );

  const client = new LeetCodeClient(2000, 5000);
  const startTime = Date.now();

  // Graceful shutdown
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(
      `\n[${timestamp()}] Shutting down gracefully — finishing current request...`,
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const problem of toFetch) {
    if (shuttingDown) break;

    current++;
    const slug = problem.titleSlug;

    try {
      const start = performance.now();
      const result = await client.query(DETAIL_QUERY, { titleSlug: slug });
      const elapsed = Math.round(performance.now() - start);

      if (result.errors) {
        const msg = result.errors.map((e) => e.message).join("; ");
        console.log(
          `[${timestamp()}] [${String(current)}/${String(total)}] ${slug} — GraphQL error: ${msg}`,
        );
        await appendErrorLog(slug, `GraphQL error: ${msg}`);
        stats.errors++;
        continue;
      }

      const parsed = QuestionResponseSchema.safeParse(result.data);
      const question = parsed.success ? parsed.data.question : null;
      if (question == null) {
        console.log(
          `[${timestamp()}] [${String(current)}/${String(total)}] ${slug} — null response (premium?)`,
        );
        await appendErrorLog(slug, "null question response");
        stats.errors++;
        continue;
      }

      // Atomic write: .tmp then rename
      const tmpPath = path.join(PROBLEMS_DIR, `${slug}.json.tmp`);
      const finalPath = path.join(PROBLEMS_DIR, `${slug}.json`);
      await Bun.write(tmpPath, JSON.stringify(question, null, 2));
      const file = Bun.file(tmpPath);
      await Bun.write(finalPath, file);
      await unlink(tmpPath);

      stats.ok++;
      console.log(
        `[${timestamp()}] [${String(current)}/${String(total)}] ${slug} — 200 OK (${String(elapsed)}ms)`,
      );
    } catch (error) {
      if (error instanceof CloudflareBlockError) {
        console.error(`\n[${timestamp()}] [BLOCKED] ${error.message}`);
        console.error(
          "Cloudflare blocked us. Progress is saved — re-run to continue.",
        );
        await appendErrorLog(slug, error.message);
        break;
      }

      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[${timestamp()}] [${String(current)}/${String(total)}] ${slug} — ERROR: ${msg}`,
      );
      await appendErrorLog(slug, msg);
      stats.errors++;
    }

    // Print summary every 100 problems
    if ((current - existing.size) % 100 === 0) {
      printProgress(current, total, startTime);
    }
  }

  // Final summary
  const elapsed = formatDuration(Date.now() - startTime);
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `[${timestamp()}] Scrape ${shuttingDown ? "interrupted" : "complete"}`,
  );
  console.log(`  Total:   ${String(total)}`);
  console.log(`  OK:      ${String(stats.ok)}`);
  console.log(`  Skipped: ${String(stats.skipped)} (already existed)`);
  console.log(`  Errors:  ${String(stats.errors)}`);
  console.log(`  Elapsed: ${elapsed}`);
  if (stats.errors > 0) {
    console.log(`  See ${ERROR_LOG_PATH} for error details`);
  }
  console.log("=".repeat(60));
}

try {
  await main();
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n[FATAL] ${msg}`);
  process.exit(1);
}
