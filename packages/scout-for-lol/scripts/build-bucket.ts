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

await $`bun --no-install run --filter='./packages/frontend' build`;
await $`bun --no-install run --filter='./packages/app' build`;

const appDist = "packages/app/dist";
const frontendDist = "packages/frontend/dist";
const target = `${frontendDist}/app`;

const appIndex = `${appDist}/index.html`;
const appIndexFile = Bun.file(appIndex);
if (!(await appIndexFile.exists())) {
  throw new Error(
    `SPA build did not produce ${appIndex} — refusing to copy or sync`,
  );
}
if (appIndexFile.size < 100) {
  throw new Error(
    `SPA index.html is suspiciously small (${String(appIndexFile.size)} bytes) — refusing to ship`,
  );
}

const frontendIndex = `${frontendDist}/index.html`;
if (!(await Bun.file(frontendIndex).exists())) {
  throw new Error(
    `Astro build did not produce ${frontendIndex} — refusing to copy or sync`,
  );
}

await $`rm -rf ${target}`;
await $`cp -R ${appDist} ${target}`;

const copiedIndex = `${target}/index.html`;
if (!(await Bun.file(copiedIndex).exists())) {
  throw new Error(`copy failed: ${copiedIndex} missing after copy`);
}

console.log(
  `Bundled scout-for-lol deploy: ${frontendDist}/index.html + ${target}/index.html`,
);
