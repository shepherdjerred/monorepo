import { Database } from "bun:sqlite";
import { SearchDb } from "./lib/search-db.ts";
import { EmbeddingClient } from "./lib/embeddings.ts";
import { chunkMarkdown } from "./lib/chunker.ts";
import { htmlToText, extractConstraints } from "./lib/html-to-text.ts";
import { SQLITE_PATH } from "./lib/config.ts";
import type { ChunkRow } from "./lib/search-db.ts";

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

type TagRow = {
  name: string;
};

type EditorialRow = {
  content_html: string | null;
};

async function main() {
  const startTime = Date.now();
  const searchDb = new SearchDb(SQLITE_PATH);
  searchDb.createFtsSchema();

  const sourceDb = new Database(SQLITE_PATH, { readonly: true });

  // Get all problems
  const problems = sourceDb
    .query("SELECT slug, title, difficulty, content_html FROM problems ORDER BY id")
    .all() as ProblemRow[];
  console.log(`[${timestamp()}] Found ${problems.length} problems`);

  // Start embedding client
  const embedder = new EmbeddingClient();
  const embeddingsAvailable = await embedder.isAvailable();
  if (embeddingsAvailable) {
    console.log(`[${timestamp()}] Embedding model available — will build vector index`);
  } else {
    console.log(`[${timestamp()}] Embedding model not available — FTS5 only`);
  }

  let indexed = 0;
  let skipped = 0;
  let errors = 0;
  let totalChunks = 0;
  const BATCH_SIZE = 20; // embed chunks in batches
  let chunkBatch: ChunkRow[] = [];
  let textBatch: string[] = [];
  let chunkMetaBatch: Omit<ChunkRow, "vector">[] = [];

  async function flushEmbeddings() {
    if (textBatch.length === 0) return;
    if (!embeddingsAvailable) { textBatch = []; chunkMetaBatch = []; return; }
    try {
      const vectors = await embedder.embed(textBatch);
      const rows: ChunkRow[] = chunkMetaBatch.map((meta, i) => ({
        ...meta,
        vector: vectors[i],
      }));
      await searchDb.addChunks(rows);
      totalChunks += rows.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [embed error] ${msg}`);
      errors++;
    }
    textBatch = [];
    chunkMetaBatch = [];
  }

  for (const problem of problems) {
    if (searchDb.isIndexed(problem.slug)) {
      skipped++;
      continue;
    }

    // Get tags
    const tags = (sourceDb.query(`
      SELECT t.name FROM topic_tags t
      JOIN problem_tags pt ON pt.tag_id = t.id
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug = ?
    `).all(problem.slug) as TagRow[]).map((t) => t.name);

    // Get editorial
    const editorial = sourceDb.query(`
      SELECT e.content_html FROM editorials e
      JOIN problems p ON p.id = e.problem_id
      WHERE p.slug = ?
    `).get(problem.slug) as EditorialRow | null;

    // Extract text sections
    const contentHtml = problem.content_html ?? "";
    const description = htmlToText(contentHtml);
    const constraints = extractConstraints(contentHtml) ?? "";
    const editorialText = editorial?.content_html ? htmlToText(editorial.content_html) : "";
    const tagsStr = tags.join(", ");

    // Add to FTS5
    searchDb.addToFts(
      problem.slug,
      problem.title,
      tagsStr,
      description,
      constraints,
      editorialText,
    );

    // Prepare chunks for embedding
    if (embeddingsAvailable) {
      const sections: Array<{ name: string; text: string }> = [
        { name: "title", text: `${problem.title} [${problem.difficulty}] ${tagsStr}` },
      ];
      if (description) sections.push({ name: "description", text: description });
      if (constraints) sections.push({ name: "constraints", text: constraints });
      if (editorialText) sections.push({ name: "editorial", text: editorialText });

      for (const section of sections) {
        const chunks = chunkMarkdown(section.text);
        for (const chunk of chunks) {
          const id = `${problem.slug}:${section.name}:${chunk.index}`;
          textBatch.push(chunk.text);
          chunkMetaBatch.push({
            id,
            problem_slug: problem.slug,
            section: section.name,
            chunk_index: chunk.index,
            text: chunk.text,
          });
        }
      }

      if (textBatch.length >= BATCH_SIZE) {
        await flushEmbeddings();
      }
    }

    indexed++;
    if (indexed % 100 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = indexed / (elapsed / 1000);
      const remaining = (problems.length - indexed - skipped) / rate;
      console.log(
        `[${timestamp()}] [${indexed + skipped}/${problems.length}] ${indexed} indexed, ${skipped} skipped, ${totalChunks} chunks | ${formatDuration(elapsed)} elapsed | eta ${formatDuration(remaining * 1000)}`,
      );
    }
  }

  // Flush remaining embeddings
  await flushEmbeddings();

  if (embeddingsAvailable) {
    embedder.shutdown();
  }

  searchDb.close();
  sourceDb.close();

  const elapsed = formatDuration(Date.now() - startTime);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${timestamp()}] Search index build complete`);
  console.log(`  Indexed:  ${indexed}`);
  console.log(`  Skipped:  ${skipped} (already indexed)`);
  console.log(`  Chunks:   ${totalChunks}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Elapsed:  ${elapsed}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
