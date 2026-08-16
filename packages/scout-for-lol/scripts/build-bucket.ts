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
 *   3. Builds the Discord Activity → `packages/activity/dist/`
 *   4. Builds the Starlight docs site → `packages/docs-site/dist/`
 *   5. Copies the SPA, Activity, and docs into the frontend deploy bucket
 *   6. Asserts all four site entrypoints exist
 *
 * Fail-fast: any missing artifact throws before the CI sync step starts.
 */

import { $ } from "bun";
import { verifyScoutAssetBucket } from "@scout-for-lol/design-system/build";

await $`bun --no-install run --filter='./packages/frontend' build`;
await $`bun --no-install run --filter='./packages/app' build`;
await $`bun --no-install run --filter='./packages/activity' build`;
await $`bun --no-install run --filter='./packages/docs-site' build`;

const appDist = "packages/app/dist";
const activityDist = "packages/activity/dist";
const docsDist = "packages/docs-site/dist";
const frontendDist = "packages/frontend/dist";
const target = `${frontendDist}/app`;
const activityTarget = `${frontendDist}/customs`;
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

const activityIndex = `${activityDist}/index.html`;
const activityIndexFile = Bun.file(activityIndex);
if (!(await activityIndexFile.exists())) {
  throw new Error(
    `Activity build did not produce ${activityIndex} — refusing to copy or sync`,
  );
}
if (activityIndexFile.size < 100) {
  throw new Error(
    `Activity index.html is suspiciously small (${String(activityIndexFile.size)} bytes) — refusing to ship`,
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
await $`rm -rf ${activityTarget}`;
await $`cp -R ${activityDist} ${activityTarget}`;
await $`rm -rf ${docsTarget}`;
await $`cp -R ${docsDist} ${docsTarget}`;

const copiedIndex = `${target}/index.html`;
const copiedActivityIndex = `${activityTarget}/index.html`;
if (!(await Bun.file(copiedIndex).exists())) {
  throw new Error(`copy failed: ${copiedIndex} missing after copy`);
}
if (!(await Bun.file(`${docsTarget}/index.html`).exists())) {
  throw new Error(`copy failed: ${docsTarget}/index.html missing after copy`);
}
if (!(await Bun.file(copiedActivityIndex).exists())) {
  throw new Error(`copy failed: ${copiedActivityIndex} missing after copy`);
}

await verifyScoutAssetBucket(frontendDist);

const bootstrapPath = "/assets/scout/brand/theme-bootstrap.js";
for (const entrypoint of [
  frontendIndex,
  copiedIndex,
  copiedActivityIndex,
  `${docsTarget}/index.html`,
]) {
  const html = await Bun.file(entrypoint).text();
  if (!html.includes(bootstrapPath)) {
    throw new Error(
      `${entrypoint} does not load the shared pre-paint theme bootstrap`,
    );
  }
}

const docsHtml = await Bun.file(`${docsTarget}/index.html`).text();
if (!docsHtml.includes('src="/docs/posthog-bootstrap.js"')) {
  throw new Error(
    `${docsTarget}/index.html does not load the shared PostHog bootstrap`,
  );
}

function docsPosthogAttr(attribute: string): string | undefined {
  return new RegExp(`${attribute}="([^"]*)"`).exec(docsHtml)?.[1];
}

// posthog-bootstrap.js silently no-ops on an invalid dataset value (see
// packages/scout-for-lol/packages/frontend/public/posthog-bootstrap.js), so
// checking attribute *names* alone would let a broken env value ship a build
// that passes verification but never actually captures analytics.
const docsApiHost = docsPosthogAttr("data-posthog-api-host");
if (docsApiHost !== "https://us.i.posthog.com") {
  throw new Error(
    `${docsTarget}/index.html must set data-posthog-api-host to the PostHog US API host, got ${String(docsApiHost)}`,
  );
}
const docsAssetHost = docsPosthogAttr("data-posthog-asset-host");
if (docsAssetHost !== "https://us-assets.i.posthog.com") {
  throw new Error(
    `${docsTarget}/index.html must set data-posthog-asset-host to the PostHog US asset host, got ${String(docsAssetHost)}`,
  );
}
const docsSessionReplay = docsPosthogAttr("data-posthog-session-replay");
if (docsSessionReplay !== "true" && docsSessionReplay !== "false") {
  throw new Error(
    `${docsTarget}/index.html must set data-posthog-session-replay to "true" or "false", got ${String(docsSessionReplay)}`,
  );
}
for (const attribute of [
  "data-posthog-project-token",
  "data-posthog-site-key",
  "data-posthog-site-domain",
]) {
  const value = docsPosthogAttr(attribute);
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${docsTarget}/index.html must set a non-empty ${attribute} for PostHog`,
    );
  }
}

console.log(
  `Bundled and verified Scout deploy: ${frontendDist}/index.html + ${target}/index.html + ${activityTarget}/index.html + ${docsTarget}/index.html + shared theme/font/brand/game assets`,
);
