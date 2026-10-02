import { expect, test } from "vitest";
import { isExpectedNavigationProbe } from "./browser-errors.ts";

test("only expected visibility refusals are excluded from page errors", () => {
  const probe =
    "http://localhost:5180/trpc/operations.availability?batch=1&input=%7B%7D";
  expect(isExpectedNavigationProbe(probe, 403)).toBe(true);
  expect(isExpectedNavigationProbe(probe, 404)).toBe(true);
  for (const status of [401, 429, 500, 502])
    expect(isExpectedNavigationProbe(probe, status)).toBe(false);
  expect(
    isExpectedNavigationProbe(
      "http://localhost:5180/trpc/consumerMatch.detail",
      403,
    ),
  ).toBe(false);
  expect(
    isExpectedNavigationProbe(
      "http://localhost:5180/trpc/operations.availability,consumerMatch.detail",
      403,
    ),
  ).toBe(false);
  expect(isExpectedNavigationProbe("", 403)).toBe(false);
});
