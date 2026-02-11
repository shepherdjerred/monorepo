#!/usr/bin/env bun

import { spawn } from "bun";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("migrate");

// Run prisma migrate deploy using Bun
const proc = spawn(["bunx", "prisma", "migrate", "deploy"], {
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await proc.exited;

if (exitCode !== 0) {
  process.exit(exitCode);
}

logger.info("✅ All migrations have been successfully applied");
