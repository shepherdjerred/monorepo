import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import { openEvalDatabase } from "#server/database.ts";
import { MIGRATIONS } from "#server/migrations.ts";

const MigrationCountSchema = z.strictObject({
  count: z.number().int().nonnegative(),
});

describe("openEvalDatabase", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "scout-evals-database-"),
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  test("creates missing parent directories for a file-backed database", async () => {
    const databasePath = path.join(
      temporaryDirectory,
      "fresh",
      "nested",
      "evals.sqlite",
    );
    const database = openEvalDatabase(databasePath);
    try {
      const databaseStats = await stat(databasePath);
      expect(databaseStats.isFile()).toBe(true);
      const migrationCount = MigrationCountSchema.parse(
        database.query("SELECT COUNT(*) AS count FROM schema_migrations").get(),
      );
      expect(migrationCount.count).toBe(MIGRATIONS.length);
    } finally {
      database.close();
    }
  });

  test("keeps the in-memory database off the filesystem", () => {
    const database = openEvalDatabase(":memory:");
    try {
      const mainDatabase = z
        .strictObject({ file: z.literal("") })
        .parse(
          database
            .query("SELECT file FROM pragma_database_list WHERE name = 'main'")
            .get(),
        );
      expect(mainDatabase).toEqual({ file: "" });
    } finally {
      database.close();
    }
  });
});
