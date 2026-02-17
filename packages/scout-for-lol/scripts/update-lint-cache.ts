#!/usr/bin/env bun
/**
 * Regenerates the .knip-cache.json and .jscpd-cache.json files
 *
 * Run this script when you want to update the lint analysis cache.
 * The ESLint rules will use these cached results instead of running
 * the slow analysis tools on every lint.
 *
 * Usage: bun scripts/update-lint-cache.ts
 */

import { $ } from "bun";

console.log("Updating lint cache files...\n");

// Generate knip cache
console.log("Running knip...");
const knipStart = Date.now();
const knipResult = await $`bunx knip --reporter json`.quiet();
await Bun.write(".knip-cache.json", knipResult.stdout);
console.log(
  `  ✓ .knip-cache.json updated (${(Date.now() - knipStart).toString()}ms)\n`,
);

// Generate jscpd cache
console.log("Running jscpd (this may take a while)...");
const jscpdStart = Date.now();
await $`bunx jscpd --reporters json --output /tmp/jscpd-lint-cache .`.quiet();
const jscpdReport = await Bun.file(
  "/tmp/jscpd-lint-cache/jscpd-report.json",
).text();
await Bun.write(".jscpd-cache.json", jscpdReport);
console.log(
  `  ✓ .jscpd-cache.json updated (${(Date.now() - jscpdStart).toString()}ms)\n`,
);

console.log("Done! ESLint will now use the cached analysis results.");
