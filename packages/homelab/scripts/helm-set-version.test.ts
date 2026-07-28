import { expect, test } from "bun:test";
import { setChartVersion } from "./migration-core.ts";

test("updates chart and application versions", () => {
  expect(setChartVersion("version: 1\nappVersion: old\n", "2.0.0")).toBe(
    "version: 2.0.0\nappVersion: 2.0.0\n",
  );
});
