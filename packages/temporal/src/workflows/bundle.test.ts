import { describe, expect, it } from "bun:test";
import { bundleWorkflowCode } from "@temporalio/worker";

// Smoke test: webpack-bundle the workflow entry the same way Worker.create
// does at startup. Catches transitive imports that pull in Node-core schemes
// webpack can't resolve (e.g. workflow code accidentally importing Sentry's
// node-core via @sentry/bun → `node:util`, `node:worker_threads`, `node:zlib`).
//
// History: PR #685 moved buildPrBody into activities/docs-groom-pr.ts,
// whose import chain transitively pulled @sentry/bun into the workflow
// bundle. The worker pod CrashLoopBackoffed at boot because webpack couldn't
// resolve `node:util`. PR #692 fixed it by moving the helper to a pure
// shared/ module. This test would have caught that bug locally in ~1 second.
describe("workflow bundle", () => {
  it("webpacks the workflow index without resolution errors", async () => {
    const workflowsPath = new URL("index.ts", import.meta.url).pathname;
    const bundle = await bundleWorkflowCode({ workflowsPath });
    expect(bundle.code.length).toBeGreaterThan(1000);
  }, 60_000);
});
