import { Database } from "bun:sqlite";
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readFrozenPlayback,
  readFrozenPlaybackBytes,
} from "./frozen-playback.ts";

function snapshot(active = false) {
  const db = new Database(":memory:");
  try {
    db.run(`CREATE TABLE sessions (id INTEGER);
      CREATE TABLE session_history (
        id INTEGER PRIMARY KEY, user_id INTEGER, started INTEGER, stopped INTEGER,
        paused_counter INTEGER, view_offset INTEGER, live INTEGER, media_type TEXT,
        platform TEXT, player TEXT, transcode_decision TEXT);
      CREATE TABLE session_history_metadata (
        id INTEGER PRIMARY KEY, rating_key INTEGER, duration INTEGER,
        full_title TEXT, grandparent_title TEXT);
      CREATE TABLE private_configuration (value TEXT);
      INSERT INTO private_configuration VALUES ('PRIVATE_CONFIGURATION_SENTINEL');
      INSERT INTO session_history VALUES (4,7,1000,1180,30,85000,0,'movie','Infuse','Living room','direct play');
      INSERT INTO session_history_metadata VALUES (4,99,100000,'Genuine source title',NULL);`);
    if (active) db.run("INSERT INTO sessions VALUES (1)");
    return db.serialize();
  } finally {
    db.close();
  }
}

test("the real frozen SQLite reader retains genuine row IDs and hashes original bytes without exporting other tables", () => {
  const bytes = snapshot();
  const original = new Uint8Array(bytes);
  const result = readFrozenPlaybackBytes(bytes);
  expect(result.expectedSessions).toBe(1);
  expect(result.rows).toMatchObject([
    {
      id: "4",
      user_id: "7",
      rating_key: "99",
      duration: 150,
      percent_complete: 85,
    },
  ]);
  expect(result.sqliteDigest).toBe(
    createHash("sha256").update(original).digest("hex"),
  );
  expect(new Uint8Array(bytes)).toEqual(original);
  expect(JSON.stringify(result)).not.toContain(
    "PRIVATE_CONFIGURATION_SENTINEL",
  );
});

test("read-only file snapshots remain unchanged and an unapplied WAL is rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "media-history-sqlite-"));
  const target = path.join(directory, "history.db");
  const bytes = snapshot();
  try {
    await Bun.write(target, bytes);
    const before = await stat(target, { bigint: true });
    expect(await readFrozenPlayback(target)).toMatchObject({
      expectedSessions: 1,
    });
    const after = await stat(target, { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
    expect(new Uint8Array(await Bun.file(target).arrayBuffer())).toEqual(
      new Uint8Array(bytes),
    );
    await Bun.write(`${target}-wal`, new Uint8Array([1]));
    await expect(readFrozenPlayback(target)).rejects.toThrow("unapplied WAL");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("active or corrupt SQLite snapshots cannot become completed history", () => {
  expect(() => readFrozenPlaybackBytes(snapshot(true))).toThrow(
    "Drain the actual Tautulli sessions",
  );
  expect(() => readFrozenPlaybackBytes(new Uint8Array([1, 2, 3]))).toThrow();
});

async function cli(bytes: Uint8Array, settled: boolean) {
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/../../../scripts/migration-playback.ts`,
      "--sqlite",
      "-",
      ...(settled ? ["--wal-settled"] : []),
    ],
    {
      cwd: `${import.meta.dir}/../../..`,
      stdin: bytes,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("the actual stdin CLI requires settled-WAL proof and exports history-only data", async () => {
  const bytes = snapshot();
  const refused = await cli(bytes, false);
  expect(refused.exitCode).toBe(1);
  expect(refused.stdout).toBe("");
  const accepted = await cli(bytes, true);
  expect(accepted.stderr).toBe("");
  expect(accepted.exitCode).toBe(0);
  expect(JSON.parse(accepted.stdout)).toMatchObject({
    expectedSessions: 1,
    rows: [{ id: "4", duration: 150 }],
  });
  expect(accepted.stdout).not.toContain("PRIVATE_CONFIGURATION_SENTINEL");
});
