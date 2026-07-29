import { Database } from "bun:sqlite";
import { z } from "zod";

import { applyMigrations } from "#server/migrations.ts";

const DatabasePathSchema = z.string().min(1);

export function openEvalDatabase(databasePath: string): Database {
  const path = DatabasePathSchema.parse(databasePath);
  const database = new Database(path, { create: true, strict: true });

  try {
    database.run("PRAGMA foreign_keys = ON;");
    database.run("PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") {
      database.run("PRAGMA journal_mode = WAL;");
    }
    applyMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
