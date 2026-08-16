import { expect, test } from "bun:test";
import path from "node:path";
import {
  loadRunBundle,
  replayRunBundle,
} from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";

test("replays the immutable schema-v1 bundle fixture", async () => {
  const fixture = path.join(import.meta.dir, "fixtures", "run-bundle-v1");
  const bundle = await loadRunBundle(fixture);
  const report = replayRunBundle(bundle, {
    currentControllerVersion: "0.1.0",
    allowVersionMismatch: false,
  });
  expect(report.schemaVersion).toBe(1);
  expect(report.status).toBe("completed");
  expect(report.eventCount).toBe(4);
});
