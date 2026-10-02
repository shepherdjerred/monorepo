import { describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  legacySqlitePreflightDigest,
  legacySqliteSourceDigest,
} from "#src/database/legacy-import/sqlite-source-digest.ts";

describe.each([
  ["import", legacySqliteSourceDigest],
  ["retirement", legacySqlitePreflightDigest],
] as const)("legacy %s digest", (_name, digest) => {
  test("waits for another process's transient source lock without changing the digest", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "scout-digest-lock-"));
    const sqlitePath = path.join(directory, "source.sqlite");
    const source = new Database(sqlitePath, { create: true });
    source.run("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)");
    source.run("INSERT INTO sample VALUES (1, 'retained')");
    source.close();
    const expected = digest(sqlitePath);
    const locker = Bun.spawn(
      [
        process.execPath,
        "-e",
        String.raw`import { Database } from "bun:sqlite";
const db = new Database(process.argv[1]);
db.run("BEGIN EXCLUSIVE");
await Bun.write(Bun.stdout, "locked\n");
await Bun.stdin.stream().getReader().read();
Bun.sleepSync(250);
db.run("COMMIT");
db.close();`,
        sqlitePath,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    try {
      const ready = await locker.stdout.getReader().read();
      expect(new TextDecoder().decode(ready.value)).toBe("locked\n");
      await locker.stdin.write("release\n");
      await locker.stdin.end();
      expect(digest(sqlitePath)).toBe(expected);
      expect(await locker.exited).toBe(0);
      expect(await new Response(locker.stderr).text()).toBe("");
    } finally {
      locker.kill();
      await locker.exited;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("still rejects a corrupt retained source", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "scout-digest-corrupt-"),
    );
    try {
      const sqlitePath = path.join(directory, "source.sqlite");
      await writeFile(sqlitePath, "not a SQLite database");
      expect(() => digest(sqlitePath)).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
