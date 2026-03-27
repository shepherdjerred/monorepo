import { Database } from "bun:sqlite";
import path from "node:path";
import { mkdirSync } from "node:fs";

export function openDatabase(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}
