import { expect, test } from "vitest";
import { manualVersionChoice } from "./stages.ts";

test("a succeeded host retirement does not suppress newer automatic sets", () => {
  expect(
    manualVersionChoice({ automatic: false, kind: "retire-host" }, "succeeded"),
  ).toBe(false);
});

test("a succeeded manual deploy still suppresses automatic sets that already exist", () => {
  expect(
    manualVersionChoice({ automatic: false, kind: "deploy" }, "succeeded"),
  ).toBe(true);
});
