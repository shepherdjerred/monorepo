import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { CloudflareBlockError, LeetCodeClient, formatDuration, timestamp } from "./lib/leetcode-graphql";

const DATA_DIR = new URL("../data", import.meta.url).pathname;
const PROBLEMS_DIR = join(DATA_DIR, "problems");
const LIST_PATH = join(DATA_DIR, "problems-list.json");
const ERROR_LOG_PATH = join(DATA_DIR, "errors.log");

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
let stats = { ok: 0, skipped: 0, errors: 0 };

async function appendErrorLog(slug: string, message: string) {
  const line = `[${timestamp()}] ${slug}: ${message}\n`;
  await Bun.write(ERROR_LOG_PATH, line, { append: true } as never);
}

function printProgress(current: number, total: number, startTime: number) {
  const pct = ((current / total) * 100).toFixed(1);
  const elapsed = Date.now() - startTime;
  const rate = current / (elapsed / 1000);
  const remaining = (total - current) / rate;
  const eta = formatDuration(remaining * 1000);
  console.log(
    `\n[Progress] ${current}/${total} (${pct}%) | ${stats.ok} ok, ${stats.skipped} skip, ${stats.errors} err | ${formatDuration(elapsed)} elapsed | eta ${eta}\n`,
  );
}

async function main() {
  if (!existsSync(LIST_PATH)) {
    console.error(`Problem list not found at ${LIST_PATH}. Run scrape:list first.`);
    process.exit(1);
  }

  const problemList: Array<{ titleSlug: string }> = await Bun.file(LIST_PATH).json();
  console.log(`[${timestamp()}] Loaded ${problemList.length} problems from list`);

  // Scan existing files for resume
  const existing = new Set<string>();
  if (existsSync(PROBLEMS_DIR)) {
    for (const file of readdirSync(PROBLEMS_DIR)) {
      if (file.endsWith(".json")) {
        existing.add(file.replace(".json", ""));
      }
    }
  }
  console.log(`[${timestamp()}] Found ${existing.size} already fetched — will skip those`);

  const toFetch = problemList.filter((p) => !existing.has(p.titleSlug));
  const total = problemList.length;
  let current = existing.size;
  stats.skipped = existing.size;

  console.log(`[${timestamp()}] Fetching ${toFetch.length} remaining problems...\n`);

  const client = new LeetCodeClient(2000, 5000);
  const startTime = Date.now();

  // Graceful shutdown
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${timestamp()}] Shutting down gracefully — finishing current request...`);
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
        console.log(`[${timestamp()}] [${current}/${total}] ${slug} — GraphQL error: ${msg}`);
        await appendErrorLog(slug, `GraphQL error: ${msg}`);
        stats.errors++;
        continue;
      }

      const question = (result.data as Record<string, unknown>)?.question;
      if (!question) {
        console.log(`[${timestamp()}] [${current}/${total}] ${slug} — null response (premium?)`);
        await appendErrorLog(slug, "null question response");
        stats.errors++;
        continue;
      }

      // Atomic write: .tmp then rename
      const tmpPath = join(PROBLEMS_DIR, `${slug}.json.tmp`);
      const finalPath = join(PROBLEMS_DIR, `${slug}.json`);
      await Bun.write(tmpPath, JSON.stringify(question, null, 2));
      const file = Bun.file(tmpPath);
      await Bun.write(finalPath, file);
      const { unlink } = await import("fs/promises");
      await unlink(tmpPath);

      stats.ok++;
      console.log(`[${timestamp()}] [${current}/${total}] ${slug} — 200 OK (${elapsed}ms)`);
    } catch (err) {
      if (err instanceof CloudflareBlockError) {
        console.error(`\n[${timestamp()}] [BLOCKED] ${err.message}`);
        console.error("Cloudflare blocked us. Progress is saved — re-run to continue.");
        await appendErrorLog(slug, err.message);
        break;
      }

      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${timestamp()}] [${current}/${total}] ${slug} — ERROR: ${msg}`);
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
  console.log(`[${timestamp()}] Scrape ${shuttingDown ? "interrupted" : "complete"}`);
  console.log(`  Total:   ${total}`);
  console.log(`  OK:      ${stats.ok}`);
  console.log(`  Skipped: ${stats.skipped} (already existed)`);
  console.log(`  Errors:  ${stats.errors}`);
  console.log(`  Elapsed: ${elapsed}`);
  if (stats.errors > 0) {
    console.log(`  See ${ERROR_LOG_PATH} for error details`);
  }
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
