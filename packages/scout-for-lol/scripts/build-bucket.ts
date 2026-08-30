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
import { cp, rm } from "node:fs/promises";
import { verifyScoutAssetBucket } from "@scout-for-lol/design-system/build";
import {
  assertScoutCustomsArtifactPolicy,
  type ScoutSiteFlavor,
} from "../../../scripts/lib/scout-customs-artifact.ts";

function siteFlavor(): ScoutSiteFlavor {
  const flavor = process.env["PUBLIC_SCOUT_SITE_FLAVOR"];
  if (flavor !== "prod" && flavor !== "beta") {
    throw new Error("PUBLIC_SCOUT_SITE_FLAVOR must be prod or beta");
  }
  return flavor;
}

const flavor = siteFlavor();

await $`bun --no-install run --filter='./packages/frontend' build`;
await $`bun --no-install run --filter='./packages/app' build`;
await $`bun --no-install run --filter='./packages/docs-site' build`;
if (flavor === "beta") {
  await $`bun --no-install run --filter='./packages/activity' build`;
}

const appDist = "packages/app/dist";
const docsDist = "packages/docs-site/dist";
const frontendDist = "packages/frontend/dist";
const target = `${frontendDist}/app`;
const docsTarget = `${frontendDist}/docs`;
const customsTarget = `${frontendDist}/customs`;

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
await rm(customsTarget, { recursive: true, force: true });
if (flavor === "beta") {
  await cp("packages/activity/dist", customsTarget, { recursive: true });
}
await assertScoutCustomsArtifactPolicy(frontendDist, flavor);

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
  `Bundled and verified Scout deploy: ${frontendDist}/index.html + ${target}/index.html + ${docsTarget}/index.html + shared theme/font/brand/game assets`,
);
