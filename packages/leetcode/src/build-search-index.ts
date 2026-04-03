import { Database } from "bun:sqlite";
import { SearchDb } from "./lib/search-db.ts";
import { EmbeddingClient } from "./lib/embeddings.ts";
import { htmlToText, extractConstraints } from "./lib/html-to-text.ts";
import { SQLITE_PATH } from "./lib/config.ts";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

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
    .query(
      "SELECT slug, title, difficulty, content_html FROM problems ORDER BY id",
    )
    .all() as ProblemRow[];
  console.log(`[${timestamp()}] Found ${problems.length} problems`);

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
      for (let i = 0; i < vectors.length; i++) {
        const slug = slugBatch[i];
        const vec = vectors[i];
        const text = textBatch[i];
        if (slug === undefined || vec === undefined || text === undefined) continue;
        searchDb.addVector(
          slug,
          new Float32Array(vec),
          text,
        );
        vectorsIndexed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [embed error] ${msg}`);
      errors++;
    }
    textBatch = [];
    slugBatch = [];
  }

  for (const problem of problems) {
    // FTS: always rebuild (idempotent via INSERT OR REPLACE)
    const tags = (
      sourceDb
        .query(
          `
      SELECT t.name FROM topic_tags t
      JOIN problem_tags pt ON pt.tag_id = t.id
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug = ?
    `,
        )
        .all(problem.slug) as TagRow[]
    ).map((t) => t.name);

    const editorial = sourceDb
      .query(
        `
      SELECT e.content_html FROM editorials e
      JOIN problems p ON p.id = e.problem_id
      WHERE p.slug = ?
    `,
      )
      .get(problem.slug) as EditorialRow | null;

    const contentHtml = problem.content_html ?? "";
    const description = htmlToText(contentHtml);
    const constraints = extractConstraints(contentHtml) ?? "";
    const editorialText = editorial?.content_html
      ? htmlToText(editorial.content_html)
      : "";
    const tagsStr = tags.join(", ");

    searchDb.addToFts(
      problem.slug,
      problem.title,
      tagsStr,
      description,
      constraints,
      editorialText,
    );
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
        `[${timestamp()}] [${total}/${problems.length}] ${vectorsIndexed} vectors, ${ftsIndexed} fts, ${skipped} skip | ${formatDuration(elapsed)} | eta ${formatDuration(remaining * 1000)}`,
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
  console.log(`  FTS indexed: ${ftsIndexed}`);
  console.log(`  Vectors:     ${vectorsIndexed}`);
  console.log(`  Skipped:     ${skipped} (already had vector)`);
  console.log(`  Errors:      ${errors}`);
  console.log(`  Elapsed:     ${elapsed}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
