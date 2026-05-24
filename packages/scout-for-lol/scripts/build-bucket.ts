#!/usr/bin/env bun
/**
 * Merged Astro + Vite SPA build for the scout-for-lol deploy bucket.
 *
 * The shared `s3-static-sites` Caddy serves `scout-for-lol.com` from a
 * single bucket. The marketing site (Astro) lives at `/`, the React SPA
 * lives at `/app/`. Both must be present in `packages/frontend/dist/`
 * before `aws s3 sync --delete` runs against the bucket — otherwise the
 * sync wipes whichever half is missing.
 *
 * This script:
 *   1. Builds the Astro marketing site → `packages/frontend/dist/`
 *   2. Builds the Vite React SPA → `packages/app/dist/`
 *   3. Copies the SPA into `packages/frontend/dist/app/`
 *   4. Asserts both `dist/index.html` and `dist/app/index.html` exist
 *
 * Fail-fast: any missing artifact throws before the CI sync step starts.
 */

import { $ } from "bun";
import { cpSync, existsSync, rmSync, statSync } from "node:fs";

await $`bun run --filter='./packages/frontend' build`;
await $`bun run --filter='./packages/app' build`;

const appDist = "packages/app/dist";
const frontendDist = "packages/frontend/dist";
const target = `${frontendDist}/app`;

const appIndex = `${appDist}/index.html`;
if (!existsSync(appIndex)) {
  throw new Error(
    `SPA build did not produce ${appIndex} — refusing to copy or sync`,
  );
}
const appIndexSize = statSync(appIndex).size;
if (appIndexSize < 100) {
  throw new Error(
    `SPA index.html is suspiciously small (${String(appIndexSize)} bytes) — refusing to ship`,
  );
}

const frontendIndex = `${frontendDist}/index.html`;
if (!existsSync(frontendIndex)) {
  throw new Error(
    `Astro build did not produce ${frontendIndex} — refusing to copy or sync`,
  );
}

rmSync(target, { recursive: true, force: true });
cpSync(appDist, target, { recursive: true });

const copiedIndex = `${target}/index.html`;
if (!existsSync(copiedIndex)) {
  throw new Error(`copy failed: ${copiedIndex} missing after cpSync`);
}

console.log(
  `Bundled scout-for-lol deploy: ${frontendDist}/index.html + ${target}/index.html`,
);
