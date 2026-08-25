import { describe, expect, test } from "vitest";
import { bundleWorkflowCode } from "@temporalio/worker";

describe("Scout workflow bundle", () => {
  test("contains only workflow-safe dependencies", async () => {
    const bundle = await bundleWorkflowCode({
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    });
    expect(bundle.code.length).toBeGreaterThan(1000);
  }, 60_000);
});
