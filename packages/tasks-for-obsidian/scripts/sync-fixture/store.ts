import assert from "node:assert/strict";
import {
  constants,
  chmod,
  lstat,
  open,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { z } from "zod";
import {
  PushSchema,
  fixtureProfile,
  type FixtureProfile,
  type Push,
  type WireFile,
} from "./contract";

const CounterSchema = z.enum([
  "pushAttempts",
  "committedUploads",
  "beforeCommitDisconnects",
  "afterCommitDisconnects",
  "protocolErrors",
]);
type Counter = z.infer<typeof CounterSchema>;
const RowSchema = z.strictObject({
  uid: z.number().int().positive(),
  metadata: z.string(),
  device: z.string(),
  content: z.instanceof(Uint8Array),
});

export async function openFixtureStore(
  directory: string,
  runID: string,
  profile: FixtureProfile,
) {
  const directoryMetadata = await lstat(directory);
  assert.ok(
    directoryMetadata.isDirectory() && !directoryMetadata.isSymbolicLink(),
  );
  assert.equal(directoryMetadata.uid, process.getuid?.());
  assert.equal(
    directoryMetadata.mode & 0o077,
    0,
    "Fixture directory must be private",
  );
  assert.equal(await realpath(directory), directory);
  const identity = {
    schemaVersion: 1,
    kind: "facet-sync-fixture",
    runID,
    profile,
  };
  const identityFile = path.join(directory, "fixture.json");
  try {
    const file = await open(
      identityFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      await file.writeFile(JSON.stringify(identity));
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    const existing = await lstat(identityFile);
    assert.ok(
      existing.isFile() &&
        !existing.isSymbolicLink() &&
        existing.uid === process.getuid?.(),
    );
    assert.equal(existing.mode & 0o077, 0);
    assert.deepEqual(
      JSON.parse(await readFile(identityFile, "utf8")),
      identity,
    );
  }
  const databaseFile = path.join(directory, "fixture.sqlite");
  try {
    const existing = await lstat(databaseFile);
    assert.ok(
      existing.isFile() &&
        !existing.isSymbolicLink() &&
        existing.uid === process.getuid?.(),
    );
    assert.ok(existing.size <= 256 * 1024 * 1024);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const database = new Database(databaseFile, { strict: true });
  await chmod(databaseFile, 0o600);
  try {
    database.run(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA locking_mode = EXCLUSIVE;
    CREATE TABLE IF NOT EXISTS events (uid INTEGER PRIMARY KEY, metadata TEXT NOT NULL, device TEXT NOT NULL, content BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  } catch (error) {
    database.close(true);
    throw error;
  }
  const settings = fixtureProfile(runID, profile);
  if (profile === "pinned-transcript-v3")
    database
      .query("INSERT OR IGNORE INTO tokens VALUES (?)")
      .run("public-synthetic-token");
  const decode = (raw: unknown) => {
    const row = RowSchema.parse(raw);
    const parsed = PushSchema.parse(JSON.parse(row.metadata));
    assert.equal(row.content.byteLength, parsed.size ?? 0);
    return {
      wire: { ...parsed, uid: row.uid, device: row.device } satisfies WireFile,
      content: row.content,
    };
  };
  const history = (cursor: number) =>
    database
      .query("SELECT * FROM events WHERE uid > ? ORDER BY uid")
      .all(cursor)
      .map((row) => decode(row));
  const current = () => {
    const value: unknown = database
      .query("SELECT max(uid) AS uid FROM events")
      .get();
    const row = z
      .strictObject({ uid: z.number().int().positive().nullable() })
      .parse(value);
    return row.uid ?? settings.initialUID;
  };
  const increment = (name: Counter) => {
    database
      .query(
        "INSERT INTO counters VALUES (?,1) ON CONFLICT(name) DO UPDATE SET value=value+1",
      )
      .run(name);
  };
  return {
    current,
    history,
    increment,
    validToken: (token: string) =>
      database.query("SELECT token FROM tokens WHERE token=?").get(token) !==
      null,
    newToken: () => {
      const token = "fixture-" + crypto.randomUUID();
      database.query("INSERT INTO tokens VALUES (?)").run(token);
      return token;
    },
    signOut: (token: string) => {
      database.query("DELETE FROM tokens WHERE token=?").run(token);
    },
    previous: (push: Push) => {
      const raw = database
        .query(
          "SELECT * FROM events WHERE json_extract(metadata,'$.path')=? ORDER BY uid DESC LIMIT 1",
        )
        .get(push.path);
      if (raw === null) return null;
      const previous = decode(raw);
      const { uid: _uid, device: _device, ...metadata } = previous.wire;
      return JSON.stringify(metadata) === JSON.stringify(push)
        ? previous
        : null;
    },
    get: (uid: number) => {
      const raw = database.query("SELECT * FROM events WHERE uid=?").get(uid);
      return raw === null ? null : decode(raw);
    },
    commit: database.transaction(
      (push: Push, device: string, content: Uint8Array) => {
        assert.equal(content.byteLength, push.size ?? 0);
        const uid = current() + 1;
        database
          .query("INSERT INTO events VALUES (?,?,?,?)")
          .run(uid, JSON.stringify(push), device, content);
        increment("committedUploads");
        return { wire: { ...push, uid, device } satisfies WireFile, content };
      },
    ),
    counters: () => {
      const counters = {
        pushAttempts: 0,
        committedUploads: 0,
        beforeCommitDisconnects: 0,
        afterCommitDisconnects: 0,
        protocolErrors: 0,
      };
      for (const raw of database
        .query("SELECT name,value FROM counters")
        .all()) {
        const row = z
          .strictObject({
            name: CounterSchema,
            value: z.number().int().nonnegative(),
          })
          .parse(raw);
        counters[row.name] = row.value;
      }
      return counters;
    },
    close: () => {
      database.close(true);
    },
  };
}
export type FixtureStore = Awaited<ReturnType<typeof openFixtureStore>>;
