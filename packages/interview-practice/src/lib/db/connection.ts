import { Database } from "bun:sqlite";
import path from "node:path";

export function openDatabase(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  Bun.spawnSync(["mkdir", "-p", dir]);
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}
