#!/usr/bin/env bun
import { deployDatabaseMigrations } from "#src/db/migrate.ts";

await deployDatabaseMigrations();
await import("../src/index.ts");
