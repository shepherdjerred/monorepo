import { describe, expect, it } from "bun:test";
import { bundleWorkflowCode } from "@temporalio/worker";

// Smoke test: webpack-bundle the workflow entry the same way Worker.create
// does at startup. Catches transitive imports that pull in Node-core schemes
// webpack can't resolve (e.g. workflow code accidentally importing Sentry's
// node-core via @sentry/bun → `node:util`, `node:worker_threads`, `node:zlib`),
// which would CrashLoopBackoff the worker pod 25 min into deploy. Runs in
// ~1 second locally as part of `bun run test`.
describe("workflow bundle", () => {
  it("webpacks the workflow index without resolution errors", async () => {
    const workflowsPath = new URL("index.ts", import.meta.url).pathname;
    const bundle = await bundleWorkflowCode({ workflowsPath });
    expect(bundle.code.length).toBeGreaterThan(1000);
  }, 60_000);
});
