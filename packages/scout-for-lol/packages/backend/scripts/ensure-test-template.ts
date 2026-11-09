#!/usr/bin/env bun
/**
 * Rebuild the hash-scoped test template database when its hash is stale.
 * Spawned synchronously by src/testing/test-template.ts from the first
 * createTestDatabase call in a test process, because seeding runs through
 * Prisma (async) while createTestDatabase must stay synchronous. Safe to run
 * by hand after changing migrations or SEASONS:
 *
 *   bun run scripts/ensure-test-template.ts
 */
import {
  ensureTestTemplate,
  getTestTemplateDatabase,
} from "#src/testing/test-template.ts";

await ensureTestTemplate();
console.log(`test template ready: ${getTestTemplateDatabase()}`);
