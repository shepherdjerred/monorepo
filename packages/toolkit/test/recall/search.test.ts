import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createRecallDb,
  RecallDb,
} from "@shepherdjerred/toolkit/lib/recall/db.ts";
import { EmbeddingClient } from "@shepherdjerred/toolkit/lib/recall/embeddings.ts";
import { hybridSearch } from "@shepherdjerred/toolkit/lib/recall/search.ts";

const tempDirs: string[] = [];

class FailingEmbeddingClient extends EmbeddingClient {
  override async embed(_texts: string[]): Promise<number[][]> {
    throw new Error("embedding failed");
  }
}

class StaticEmbeddingClient extends EmbeddingClient {
  override async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1]);
  }
}

class FailingVectorRecallDb extends RecallDb {
  override async vectorSearch(
    _queryVector: number[],
    _limit: number,
  ): Promise<Awaited<ReturnType<RecallDb["vectorSearch"]>>> {
    throw new Error("vector failed");
  }
}

class InspectableRecallDb extends RecallDb {
  getLanceDirForTest(): string {
    return this.lanceDir;
  }
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("recall search", () => {
  test("creates an empty index before reopening a missing database read-only", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolkit-recall-"));
    tempDirs.push(tempDir);
    const sqlitePath = path.join(tempDir, "nested", "recall.db");

    expect(await Bun.file(sqlitePath).exists()).toBe(false);

    const readOnlyDb = await createRecallDb({ readOnly: true }, sqlitePath);

    expect(readOnlyDb.readOnly).toBe(true);
    expect(readOnlyDb.getDocCount()).toBe(0);
    expect(readOnlyDb.getChunkCount()).toBe(0);
    expect(readOnlyDb.recordStat("search", 1, { query: "empty" })).toBe(false);
    readOnlyDb.close();
  });

  test("derives LanceDB storage next to custom SQLite paths", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolkit-recall-"));
    tempDirs.push(tempDir);
    const sqlitePath = path.join(tempDir, "isolated", "recall.db");
    await mkdir(path.dirname(sqlitePath), { recursive: true });

    const db = new InspectableRecallDb(sqlitePath);

    expect(db.getLanceDirForTest()).toBe(
      path.join(tempDir, "isolated", "lance"),
    );
    db.close();
  });

  test("can query a read-only SQLite index without writing telemetry", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolkit-recall-"));
    tempDirs.push(tempDir);
    const sqlitePath = path.join(tempDir, "recall.db");
    const docPath = path.join(tempDir, "needle.md");

    const writableDb = new RecallDb(sqlitePath);
    writableDb.upsertFts(
      docPath,
      "Needle Doc",
      "test",
      "The durable needle appears in this document.",
    );
    writableDb.upsertMetadata({
      path: docPath,
      title: "Needle Doc",
      tags: "test",
      source: "unit-test",
      content_hash: "hash",
      mtime: 1,
      chunk_count: 1,
      indexed_at: new Date(0).toISOString(),
    });
    writableDb.close();

    await chmod(sqlitePath, 0o400);

    const readOnlyDb = new RecallDb(sqlitePath, { readOnly: true });
    const results = await hybridSearch(readOnlyDb, null, {
      query: "durable needle",
      limit: 5,
      mode: "keyword",
      verbose: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: docPath,
      title: "Needle Doc",
      source: "unit-test",
    });
    expect(
      readOnlyDb.recordStat("search", 1, { query: "durable needle" }),
    ).toBe(false);
    readOnlyDb.close();
  });

  test("records telemetry when embedding fallback uses a writable database", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolkit-recall-"));
    tempDirs.push(tempDir);
    const sqlitePath = path.join(tempDir, "recall.db");
    const docPath = path.join(tempDir, "fallback.md");

    const writableDb = new RecallDb(sqlitePath);
    writableDb.upsertFts(
      docPath,
      "Fallback Doc",
      "test",
      "The fallback query appears in this document.",
    );
    writableDb.upsertMetadata({
      path: docPath,
      title: "Fallback Doc",
      tags: "test",
      source: "unit-test",
      content_hash: "hash",
      mtime: 1,
      chunk_count: 1,
      indexed_at: new Date(0).toISOString(),
    });

    const results = await hybridSearch(
      writableDb,
      new FailingEmbeddingClient(),
      {
        query: "fallback query",
        limit: 5,
        mode: "hybrid",
        verbose: false,
      },
    );

    const stats = writableDb.sqlite
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) AS count FROM stats WHERE event = 'search'")
      .get();

    expect(results).toHaveLength(1);
    expect(stats?.count).toBe(1);
    writableDb.close();
  });

  test("records telemetry before rethrowing semantic vector failures", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolkit-recall-"));
    tempDirs.push(tempDir);
    const sqlitePath = path.join(tempDir, "recall.db");
    const writableDb = new FailingVectorRecallDb(sqlitePath);

    await expect(
      hybridSearch(writableDb, new StaticEmbeddingClient(), {
        query: "semantic query",
        limit: 5,
        mode: "semantic",
        verbose: false,
      }),
    ).rejects.toThrow("vector failed");

    const stat = writableDb.sqlite
      .query<
        { count: number; details: string },
        []
      >("SELECT COUNT(*) AS count, details FROM stats WHERE event = 'search'")
      .get();

    expect(stat?.count).toBe(1);
    expect(JSON.parse(stat?.details ?? "{}")).toEqual({
      query: "semantic query",
      results: 0,
      mode: "semantic",
    });
    writableDb.close();
  });
});
