import { Database } from "bun:sqlite";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";
import { runMigrations } from "./migrations/index.js";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    const config = getConfig();
    const dbPath = config.database.path;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");

    runMigrations(db);

    logger.info("Database initialized", { path: dbPath });
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
