#!/usr/bin/env bun
/**
 * Smoke test for the scout-for-lol backend image.
 *
 * The final image no longer bundles a database it can run against (the app
 * speaks Postgres, and only the `smoke` build stage carries one), so the
 * local smoke is the same as CI's: build the `smoke` stage, whose RUN step
 * executes .buildkite/scripts/smoke-app-in-image.ts as uid 1000 — initdb +
 * pg_ctl a throwaway Postgres, then migrate → legacy import (fresh-install
 * path) → report audit → boot until the expected Discord auth failure.
 * A failing smoke fails the build; one harness for local and CI.
 */
const REPO_ROOT = `${import.meta.dir}/../../../../..`;
const DOCKERFILE = "packages/scout-for-lol/packages/backend/Dockerfile";

const proc = Bun.spawn(
  [
    "docker",
    "buildx",
    "build",
    "--target",
    "smoke",
    "-f",
    DOCKERFILE,
    "--progress",
    "plain",
    REPO_ROOT,
  ],
  { stdout: "inherit", stderr: "inherit" },
);

const code = await proc.exited;
if (code !== 0) {
  console.error(`smoke stage build failed (exit ${code.toString()})`);
  process.exit(code);
}
console.log(
  "smoke passed: image boots against Postgres to the Discord auth path",
);
