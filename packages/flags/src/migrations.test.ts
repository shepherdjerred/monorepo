import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { migrate, migrations, userVersion } from "./migrations.ts";
import { FlagStore } from "./store.ts";

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "flags-migrations-"));
  dbPath = path.join(dir, "flags.sqlite");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const legacyFlag: FlagValue = {
  type: "boolean",
  key: "dares_enabled",
  default: true,
  rollouts: [],
};

/** The schema every image wrote before `user_version` existed. */
function writeV0Database(): void {
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run(
    "CREATE TABLE deployment (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
  );
  db.run(`CREATE TABLE flag (
    deployment_id TEXT NOT NULL REFERENCES deployment(id),
    key TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (deployment_id, key)
  )`);
  db.query("INSERT INTO deployment (id, revision) VALUES (?, ?)").run(
    "scout/prod",
    7,
  );
  db.query("INSERT INTO flag (deployment_id, key, body) VALUES (?, ?, ?)").run(
    "scout/prod",
    legacyFlag.key,
    JSON.stringify(legacyFlag),
  );
  db.close();
}

function tableNames(db: Database): string[] {
  return db
    .query<{ readonly name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

test("migrates a v0 file database in place and keeps its documents", () => {
  writeV0Database();
  const migratedAt = new Date("2026-11-20T12:00:00.000Z");
  const store = FlagStore.open(dbPath, { now: () => migratedAt });
  try {
    expect(store.document("scout/prod")).toEqual({
      id: "scout/prod",
      revision: 7,
      flags: [legacyFlag],
    });
    expect(store.audit.startedAt()).toEqual(migratedAt);
    expect(
      store.audit.history("scout/prod", legacyFlag.key, { limit: 10 }).entries,
    ).toEqual([]);
  } finally {
    store.close();
  }
  const db = new Database(dbPath);
  try {
    expect(userVersion(db)).toBe(migrations.length);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["flag_audit", "flag_audit_key", "store_meta"]),
    );
  } finally {
    db.close();
  }
});

test("reopening a migrated database runs nothing and keeps audit_started_at", () => {
  writeV0Database();
  const first = new Date("2026-11-20T12:00:00.000Z");
  FlagStore.open(dbPath, { now: () => first }).close();
  const store = FlagStore.open(dbPath, {
    now: () => new Date("2026-11-21T12:00:00.000Z"),
  });
  try {
    expect(store.audit.startedAt()).toEqual(first);
    expect(store.document("scout/prod")?.revision).toBe(7);
  } finally {
    store.close();
  }
});

test("a failing step rolls back its DDL and user_version together", () => {
  writeV0Database();
  const db = new Database(dbPath);
  try {
    expect(() => {
      migrate(db, new Date(), [
        {
          version: 1,
          up(target) {
            target.run("CREATE TABLE step_one (id INTEGER)");
          },
        },
        {
          version: 2,
          up(target) {
            target.run("CREATE TABLE step_two (id INTEGER)");
            throw new Error("step two failed");
          },
        },
      ]);
    }).toThrow("step two failed");
    expect(userVersion(db)).toBe(1);
    expect(tableNames(db)).toContain("step_one");
    expect(tableNames(db)).not.toContain("step_two");

    expect(() => {
      migrate(db, new Date(), [
        { version: 1, up: (target) => target.run("SELECT 1") },
        {
          version: 2,
          up(target) {
            target.run("CREATE TABLE step_two (id INTEGER)");
            target.run("INSERT INTO missing_table VALUES (1)");
          },
        },
      ]);
    }).toThrow(/missing_table/u);
    expect(userVersion(db)).toBe(1);
    expect(tableNames(db)).not.toContain("step_two");
  } finally {
    db.close();
  }
});

test("refuses a database written by a newer schema", () => {
  writeV0Database();
  const db = new Database(dbPath);
  db.run(`PRAGMA user_version = ${String(migrations.length + 1)}`);
  db.close();
  expect(() => FlagStore.open(dbPath)).toThrow(
    /newer than this image supports/u,
  );
});
