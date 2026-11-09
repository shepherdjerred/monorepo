import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { localOwnerAlive } from "./process-owner.ts";

/** Same conditional-write contract as production, persisted across local invocations. */
export async function localPromotionStore(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const filename = path.join(directory, "promotion.sqlite");
  const db = new Database(filename, { create: true, strict: true });
  await chmod(filename, 0o600);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run(
    "CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, value TEXT NOT NULL, etag TEXT NOT NULL)",
  );
  const read = db.query("SELECT value, etag FROM objects WHERE key = ?");
  const RowSchema = z.object({ value: z.string(), etag: z.string() });
  const store: PromotionStore = {
    read: (key, schema) => {
      const row = read.get(key);
      if (row === null) return Promise.resolve(undefined);
      const parsed = RowSchema.parse(row);
      return Promise.resolve({
        value: schema.parse(JSON.parse(parsed.value)),
        etag: parsed.etag,
      });
    },
    put: (key, value, expectedEtag) => {
      const etag = crypto.randomUUID();
      const serialized = JSON.stringify(value);
      const result =
        expectedEtag === undefined
          ? db
              .query(
                "INSERT OR IGNORE INTO objects (key, value, etag) VALUES (?, ?, ?)",
              )
              .run(key, serialized, etag)
          : db
              .query(
                "UPDATE objects SET value = ?, etag = ? WHERE key = ? AND etag = ?",
              )
              .run(serialized, etag, key, expectedEtag);
      return Promise.resolve(result.changes === 1);
    },
  };
  return {
    store,
    close: () => {
      db.close();
    },
  };
}

/** One local executor across accounts; status and pause remain available. */
export async function claimLocalSession(store: PromotionStore) {
  const key = "local/session.json";
  const SessionSchema = z.object({
    pid: z.number().int().positive().nullable(),
    acquiredAt: z.string().optional(),
  });
  const current = await store.read(key, SessionSchema);
  if (
    current?.value.pid !== null &&
    current?.value.pid !== undefined &&
    localOwnerAlive(current.value.pid, current.value.acquiredAt)
  ) {
    throw new Error("A local promotion executor is already running");
  }
  if (
    !(await store.put(
      key,
      { pid: process.pid, acquiredAt: new Date().toISOString() },
      current?.etag,
    ))
  )
    throw new Error("Another local executor claimed this session");
  const owned = await store.read(key, SessionSchema);
  if (owned === undefined) throw new Error("Local session claim disappeared");
  return async () => {
    if (!(await store.put(key, { pid: null }, owned.etag)))
      throw new Error("Local session ownership changed");
  };
}
