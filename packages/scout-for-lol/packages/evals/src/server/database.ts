import { Database } from "bun:sqlite";
import path from "node:path";
import { z } from "zod";

import { applyMigrations } from "#server/migrations.ts";

const DatabasePathSchema = z.string().min(1);

export function openEvalDatabase(databasePath: string): Database {
  const validatedPath = DatabasePathSchema.parse(databasePath);
  if (validatedPath !== ":memory:") {
    const directory = path.dirname(validatedPath);
    const result = Bun.spawnSync(["mkdir", "-p", "--", directory]);
    if (!result.success) {
      throw new Error(
        `Failed to create database directory ${directory}: ${result.stderr.toString().trim()}`,
      );
    }
  }
  const database = new Database(validatedPath, { create: true, strict: true });

  try {
    database.run("PRAGMA foreign_keys = ON;");
    database.run("PRAGMA busy_timeout = 5000;");
    if (validatedPath !== ":memory:") {
      database.run("PRAGMA journal_mode = WAL;");
    }
    applyMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
