import { expect, test } from "vitest";
import { truncate } from "./ops-types.ts";

test("leaves text within the budget unchanged", () => {
  expect(truncate("Deploy failed", 200)).toBe("Deploy failed");
});

test("keeps the ellipsis inside the budget", () => {
  expect(truncate("x".repeat(250), 200)).toBe(`${"x".repeat(199)}…`);
});

test("never splits an emoji in a PR title at the cut", () => {
  const result = truncate(`${"x".repeat(198)}✨🐛 fix`, 200);
  expect(result).toBe(`${"x".repeat(198)}✨…`);
  expect(result.isWellFormed()).toBe(true);
});
