import { describe, expect, it } from "vitest";
import { bundleWorkflowCode } from "@temporalio/worker";
import vm from "node:vm";
import { z } from "zod";

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
    const context = vm.createContext({ __webpack_module_cache__: {} });
    vm.runInContext(bundle.code, context);
    const workflows = z
      .record(z.string(), z.unknown())
      .parse(vm.runInContext("__TEMPORAL__.importWorkflows()", context));
    for (const name of [
      "maintainStormForumWorkflow",
      "backupStormForumWorkflow",
      "runSeaweedFsBackupWorkflow",
      "runSeaweedFsBackupRetentionAndGcWorkflow",
    ]) {
      expect(typeof workflows[name]).toBe("function");
    }
  }, 60_000);
});
