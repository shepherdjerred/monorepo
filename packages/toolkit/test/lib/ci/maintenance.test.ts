import { expect, test } from "vitest";
import { maintenanceKind } from "#lib/ci/maintenance.ts";
import { ciFixture } from "./fixtures.ts";

test.each(["release-notes", "ci-images", "superseded"])(
  "classifies only explicit main manual maintenance (%s)",
  (kind) => {
    const pipeline = ciFixture().pipeline;
    if (pipeline === null) throw new Error("Missing fixture");
    pipeline.workflows = [{ name: `maintenance-${kind}`, state: "success" }];
    expect(maintenanceKind(pipeline)).toBeNull();
    pipeline.event = "manual";
    pipeline.branch = "main";
    expect(maintenanceKind(pipeline)).toBe(kind);
    pipeline.branch = "feature";
    expect(maintenanceKind(pipeline)).toBeNull();
  },
);
test("normal manual recovery stays a verification pipeline", () => {
  const pipeline = ciFixture().pipeline;
  if (pipeline === null) throw new Error("Missing fixture");
  pipeline.event = "manual";
  pipeline.branch = "main";
  expect(maintenanceKind(pipeline)).toBeNull();
});
