import { expect, test } from "vitest";
import { outputPath } from "./ios-scripts-core.ts";

test("defaults to the established device log", () => {
  expect(outputPath()).toBe("/tmp/device.log");
});
