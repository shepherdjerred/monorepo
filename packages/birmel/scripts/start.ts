#!/usr/bin/env bun
import { deployDatabaseMigrations } from "@shepherdjerred/birmel/database/migration-bootstrap.ts";

await deployDatabaseMigrations();
await import("../src/index.ts");
