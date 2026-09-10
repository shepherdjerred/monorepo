import { expect, test } from "vitest";
import { chartName } from "#scripts/migration-core.ts";

test("extracts a chart directory name", () => {
  expect(chartName("/tmp/charts/velero/")).toBe("velero");
});
