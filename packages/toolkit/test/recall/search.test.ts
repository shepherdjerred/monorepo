import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { RecallDb } from "@shepherdjerred/toolkit/lib/recall/db.ts";
import { hybridSearch } from "@shepherdjerred/toolkit/lib/recall/search.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("recall search", () => {
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
});
