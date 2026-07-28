import { expect, test } from "bun:test";
import { lanePaths } from "./migration-core.ts";

test("all expected deployment lanes are modeled", () => {
  expect(Object.keys(lanePaths)).toContain("sites");
  expect(Object.keys(lanePaths)).toContain("ci-image");
  expect(lanePaths["sites"]?.length).toBeGreaterThan(
    lanePaths["site-resume"]?.length ?? 0,
  );
});
