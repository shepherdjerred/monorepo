#!/usr/bin/env bun
/**
 * Rebuilds the Storybook catalog only when the existing build is stale.
 *
 * `bun run test:e2e` has to work standalone — `catalog.spec.ts` reads
 * `storybook-static/index.json` off disk during spec collection — but
 * `turbo run test:e2e` already rebuilds the catalog as a task dependency
 * (`app/turbo.json`'s `dependsOn`). Rebuilding unconditionally here doubles
 * that work on every Turbo-driven run; skipping whenever the output merely
 * *exists* lets a story or component edit go untested by the direct command
 * with no rebuild in between. Comparing mtimes avoids both: a fresh build sits
 * newer than its sources and is left alone either way.
 */
import { $ } from "bun";

const OUTPUT = "storybook-static/index.json";
const WATCHED_GLOBS = [
  "src/**/*",
  "e2e/**/*",
  ".storybook/**/*",
  "package.json",
];

async function newestSourceMtimeMs(): Promise<number> {
  let newest = 0;
  for (const pattern of WATCHED_GLOBS) {
    for await (const path of new Bun.Glob(pattern).scan(".")) {
      const mtime = Bun.file(path).lastModified;
      if (mtime > newest) newest = mtime;
    }
  }
  return newest;
}

async function catalogIsFresh(): Promise<boolean> {
  const output = Bun.file(OUTPUT);
  return (await output.exists())
    ? output.lastModified > (await newestSourceMtimeMs())
    : false;
}

if (!(await catalogIsFresh())) {
  await $`bun x --no-install storybook build`;
}
