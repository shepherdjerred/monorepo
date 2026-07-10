import { Database } from "bun:sqlite";
import { SearchDb } from "./lib/search-db.ts";
import { EmbeddingClient } from "./lib/embeddings.ts";
import { htmlToText, extractConstraints } from "./lib/html-to-text.ts";
import { SQLITE_PATH } from "./lib/config.ts";
import { formatDuration, timestamp } from "./lib/format.ts";

type ProblemRow = {
  slug: string;
  title: string;
  difficulty: string;
  content_html: string | null;
};

type TagRow = { name: string };
type EditorialRow = { content_html: string | null };

async function main() {
  const startTime = Date.now();
  const searchDb = new SearchDb(SQLITE_PATH);
  searchDb.createSchema();

  const sourceDb = new Database(SQLITE_PATH, { readonly: true });
  const problems = sourceDb
    .query<
      ProblemRow,
      []
    >("SELECT slug, title, difficulty, content_html FROM problems ORDER BY id")
    .all();
  console.log(`[${timestamp()}] Found ${String(problems.length)} problems`);

  const embedder = new EmbeddingClient();
  const embeddingsAvailable = await embedder.isAvailable();
  console.log(
    `[${timestamp()}] Embeddings: ${embeddingsAvailable ? "available" : "not available (FTS5 only)"}`,
  );

  let ftsIndexed = 0;
  let vectorsIndexed = 0;
  let skipped = 0;
  let errors = 0;

  const BATCH_SIZE = 20;
  let textBatch: string[] = [];
  let slugBatch: string[] = [];

  async function flushEmbeddings() {
    if (textBatch.length === 0 || !embeddingsAvailable) {
      textBatch = [];
      slugBatch = [];
      return;
    }
    try {
      const vectors = await embedder.embed(textBatch);
      for (const [i, vec] of vectors.entries()) {
        const slug = slugBatch[i];
        const text = textBatch[i];
        if (slug === undefined || text === undefined) continue;
        searchDb.addVector(slug, new Float32Array(vec), text);
        vectorsIndexed++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  [embed error] ${msg}`);
      errors++;
    }
    textBatch = [];
    slugBatch = [];
  }

  for (const problem of problems) {
    // FTS: always rebuild (idempotent via INSERT OR REPLACE)
    const tags = sourceDb
      .query<TagRow, [string]>(
        `
      SELECT t.name FROM topic_tags t
      JOIN problem_tags pt ON pt.tag_id = t.id
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug = ?
    `,
      )
      .all(problem.slug)
      .map((t) => t.name);

    const editorial = sourceDb
      .query<EditorialRow, [string]>(
        `
      SELECT e.content_html FROM editorials e
      JOIN problems p ON p.id = e.problem_id
      WHERE p.slug = ?
    `,
      )
      .get(problem.slug);

    const contentHtml = problem.content_html ?? "";
    const description = htmlToText(contentHtml);
    const constraints = extractConstraints(contentHtml) ?? "";
    const editorialHtml = editorial?.content_html;
    const editorialText =
      editorialHtml != null && editorialHtml !== ""
        ? htmlToText(editorialHtml)
        : "";
    const tagsStr = tags.join(", ");

    searchDb.addToFts({
      slug: problem.slug,
      title: problem.title,
      tags: tagsStr,
      description,
      constraints,
      editorial: editorialText,
    });
    ftsIndexed++;

    // Vector: one embedding per problem (title + tags + description)
    if (embeddingsAvailable && !searchDb.hasVector(problem.slug)) {
      const embeddingText = `${problem.title} [${problem.difficulty}] ${tagsStr}\n\n${description}`;
      textBatch.push(embeddingText);
      slugBatch.push(problem.slug);

      if (textBatch.length >= BATCH_SIZE) {
        await flushEmbeddings();
      }
    } else if (searchDb.hasVector(problem.slug)) {
      skipped++;
    }

    const total = ftsIndexed + skipped;
    if (total % 200 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = total / (elapsed / 1000);
      const remaining = (problems.length - total) / rate;
      console.log(
        `[${timestamp()}] [${String(total)}/${String(problems.length)}] ${String(vectorsIndexed)} vectors, ${String(ftsIndexed)} fts, ${String(skipped)} skip | ${formatDuration(elapsed)} | eta ${formatDuration(remaining * 1000)}`,
      );
    }
  }

  await flushEmbeddings();
  if (embeddingsAvailable) embedder.shutdown();

  searchDb.close();
  sourceDb.close();

  const elapsed = formatDuration(Date.now() - startTime);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${timestamp()}] Search index build complete`);
  console.log(`  FTS indexed: ${String(ftsIndexed)}`);
  console.log(`  Vectors:     ${String(vectorsIndexed)}`);
  console.log(`  Skipped:     ${String(skipped)} (already had vector)`);
  console.log(`  Errors:      ${String(errors)}`);
  console.log(`  Elapsed:     ${elapsed}`);
  console.log("=".repeat(60));
}

try {
  await main();
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n[FATAL] ${msg}`);
  process.exit(1);
}
