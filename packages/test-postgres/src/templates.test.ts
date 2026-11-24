import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { computeMigrationHash, managedPostgresDataRoots } from "./index.ts";
import { readFileTextSync } from "./read-sync.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "test-postgres-templates-"));
  tempDirs.push(dir);
  return dir;
}

describe("cross-platform synchronous migration hashing and version reads", () => {
  test("computeMigrationHash hashes migrations without Bun.mmap and changes on content or extra input edits", async () => {
    const migrationsDir = await makeTempDir();
    await Bun.write(
      path.join(migrationsDir, "0001_init", "migration.sql"),
      "CREATE TABLE items (id INT PRIMARY KEY);\n",
    );
    await Bun.write(
      path.join(migrationsDir, "0002_add_name", "migration.sql"),
      "ALTER TABLE items ADD COLUMN name TEXT;\n",
    );

    const first = computeMigrationHash({ migrationsDir });
    const repeat = computeMigrationHash({ migrationsDir });
    expect(first).toBe(repeat);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);

    const withExtra = computeMigrationHash({
      migrationsDir,
      extraInputs: ["seed-v2"],
    });
    expect(withExtra).not.toBe(first);

    await Bun.write(
      path.join(migrationsDir, "0002_add_name", "migration.sql"),
      "ALTER TABLE items ADD COLUMN label TEXT;\n",
    );
    const updated = computeMigrationHash({ migrationsDir });
    expect(updated).not.toBe(first);
  });

  test("readFileTextSync reads PG_VERSION files synchronously on all platforms", async () => {
    const dir = await makeTempDir();
    const versionFile = path.join(dir, "PG_VERSION");
    await Bun.write(versionFile, "18\r\n");

    expect(readFileTextSync(versionFile).trim()).toBe("18");
  });

  test("managedPostgresDataRoots isolates Windows test data to monorepo-test-pg without Scout dev paths", () => {
    const roots = managedPostgresDataRoots(
      {
        LOCALAPPDATA: String.raw`C:\Users\Jerred\AppData\Local`,
        USERPROFILE: String.raw`C:\Users\Jerred`,
      },
      { isRoot: false, platform: "win32" },
    );
    expect(roots).toEqual([
      path.join(
        String.raw`C:\Users\Jerred\AppData\Local`,
        "monorepo-test-pg",
        "18",
      ),
      path.join(
        String.raw`C:\Users\Jerred`,
        ".cache",
        "monorepo-test-pg",
        "18",
      ),
    ]);
  });
});
