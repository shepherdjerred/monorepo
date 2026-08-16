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
 *   3. Builds the Starlight docs site → `packages/docs-site/dist/`
 *   4. Copies the SPA and docs into the frontend deploy bucket
 *   5. Asserts all three site entrypoints exist
 *
 * Fail-fast: any missing artifact throws before the CI sync step starts.
 */

import { $ } from "bun";
import { verifyScoutAssetBucket } from "@scout-for-lol/design-system/build";

await $`bun --no-install run --filter='./packages/frontend' build`;
await $`bun --no-install run --filter='./packages/app' build`;
await $`bun --no-install run --filter='./packages/docs-site' build`;

const appDist = "packages/app/dist";
const docsDist = "packages/docs-site/dist";
const frontendDist = "packages/frontend/dist";
const target = `${frontendDist}/app`;
const docsTarget = `${frontendDist}/docs`;

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

const docsIndex = `${docsDist}/index.html`;
if (!(await Bun.file(docsIndex).exists())) {
  throw new Error(
    `Starlight build did not produce ${docsIndex} — refusing to copy or sync`,
  );
}

await $`rm -rf ${target}`;
await $`cp -R ${appDist} ${target}`;
await $`rm -rf ${docsTarget}`;
await $`cp -R ${docsDist} ${docsTarget}`;

const copiedIndex = `${target}/index.html`;
if (!(await Bun.file(copiedIndex).exists())) {
  throw new Error(`copy failed: ${copiedIndex} missing after copy`);
}
if (!(await Bun.file(`${docsTarget}/index.html`).exists())) {
  throw new Error(`copy failed: ${docsTarget}/index.html missing after copy`);
}

await verifyScoutAssetBucket(frontendDist);

const bootstrapPath = "/assets/scout/brand/theme-bootstrap.js";
for (const entrypoint of [
  frontendIndex,
  copiedIndex,
  `${docsTarget}/index.html`,
]) {
  const html = await Bun.file(entrypoint).text();
  if (!html.includes(bootstrapPath)) {
    throw new Error(
      `${entrypoint} does not load the shared pre-paint theme bootstrap`,
    );
  }
}

console.log(
  `Bundled and verified Scout deploy: ${frontendDist}/index.html + ${target}/index.html + ${docsTarget}/index.html + shared theme/font/brand/game assets`,
);
