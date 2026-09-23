#!/usr/bin/env bun

import { handleBrimCommand } from "#commands/brim/brim.ts";

try {
  await handleBrimCommand(process.argv.slice(2));
} catch (error: unknown) {
  console.error("Fatal error:", error);
  process.exit(1);
}
