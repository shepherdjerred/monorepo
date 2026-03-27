import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import matter from "gray-matter";
import { chunkMarkdown } from "./chunker.ts";
import { readConversation } from "./conversation-reader.ts";
import type { RecallDb, ChunkRow, MetadataRow } from "./db.ts";
import type { EmbeddingClient } from "./embeddings.ts";

export type IndexResult = {
  path: string;
  chunksCreated: number;
  skipped: boolean;
  durationMs: number;
};

export type IndexFileOptions = {
  db: RecallDb;
  embedder: EmbeddingClient | null;
  filePath: string;
  source: string;
  tags?: string[];
  force?: boolean;
  verbose?: boolean;
};

export async function indexFile(options: IndexFileOptions): Promise<IndexResult> {
  const { db, embedder, filePath, source, tags = [], force = false, verbose = false } = options;
  const start = performance.now();
  const absPath = path.resolve(filePath);

  // Read file
  const fileStat = await stat(absPath);
  const isConversation = absPath.endsWith(".jsonl");

  // For conversations, use file mtime as a quick change check
  // (hashing 50MB JSONL files is slow)
  const rawContent = isConversation ? null : await readFile(absPath, "utf8");
  const contentHash = isConversation
    ? `mtime:${String(fileStat.mtimeMs)}`
    : createHash("sha256").update(rawContent ?? "").digest("hex");

  // Check if already indexed with same hash
  if (!force) {
    const existing = db.getMetadata(absPath);
    if (existing?.content_hash === contentHash) {
      return {
        path: absPath,
        chunksCreated: 0,
        skipped: true,
        durationMs: performance.now() - start,
      };
    }
  }

  // Parse content based on file type
  let body: string;
  let title: string;
  let fileTags: string[];

  if (isConversation) {
    body = await readConversation(absPath);
    title = path.basename(absPath, ".jsonl");
    fileTags = [...tags];
  } else {
    const { data, content: mdBody } = matter(rawContent ?? "");
    body = mdBody;
    const rawTitle = data["title"];
    title = typeof rawTitle === "string"
      ? rawTitle
      : path.basename(absPath, path.extname(absPath));
    const rawTags = data["tags"];
    fileTags = [
      ...tags,
      ...(Array.isArray(rawTags) ? rawTags.map(String) : []),
    ];
  }

  if (verbose) {
    console.error(`[index] ${absPath} (${String(body.length)} chars)`);
  }

  // Chunk
  const chunks = chunkMarkdown(body);

  if (verbose) {
    console.error(`[index] ${String(chunks.length)} chunks`);
  }

  // Remove old data
  await db.deleteChunks(absPath);
  db.deleteFts(absPath);

  // Embed and store
  if (chunks.length > 0) {
    let vectors: number[][];

    if (embedder == null) {
      // Fallback: zero vectors (FTS-only mode)
      const { mockEmbed } = await import("./embeddings.ts");
      vectors = chunks.map((c) => mockEmbed(c.text));
    } else {
      const texts = chunks.map((c) => c.text);
      vectors = await embedder.embed(texts);
    }

    const chunkRows: ChunkRow[] = chunks.map((chunk, i) => ({
      id: `${absPath}:${String(chunk.index)}`,
      doc_path: absPath,
      chunk_index: chunk.index,
      text: chunk.text,
      vector: vectors[i] ?? [],
    }));

    await db.addChunks(chunkRows);

    // FTS: index full body for keyword search
    db.upsertFts(absPath, title, fileTags.join(" "), body);
  }

  // Update metadata
  const meta: MetadataRow = {
    path: absPath,
    title,
    tags: fileTags.join(","),
    source,
    content_hash: contentHash,
    mtime: fileStat.mtimeMs,
    chunk_count: chunks.length,
    indexed_at: new Date().toISOString(),
  };
  db.upsertMetadata(meta);

  const durationMs = performance.now() - start;

  if (verbose) {
    console.error(
      `[index] done: ${String(chunks.length)} chunks in ${String(Math.round(durationMs))}ms`,
    );
  }

  // Record stat
  db.recordStat("index", durationMs, {
    path: absPath,
    chunks: chunks.length,
    source,
  });

  return {
    path: absPath,
    chunksCreated: chunks.length,
    skipped: false,
    durationMs,
  };
}

export async function removeFile(
  db: RecallDb,
  filePath: string,
  verbose = false,
): Promise<boolean> {
  const absPath = path.resolve(filePath);
  const existing = db.getMetadata(absPath);
  if (existing == null) return false;

  await db.deleteChunks(absPath);
  db.deleteFts(absPath);
  db.deleteMetadata(absPath);

  if (verbose) {
    console.error(`[remove] ${absPath}`);
  }

  return true;
}
