import { expect, test } from "vitest";
import { truncateForToolLog } from "./goal-tool-log.ts";

test("leaves bodies within the limit untouched", () => {
  expect(truncateForToolLog("short", 10)).toBe("short");
});

test("never leaves half an emoji before the ellipsis", () => {
  const result = truncateForToolLog(`a${"😀".repeat(10)}`, 4);
  expect(result).toBe("a😀…");
  expect(result.isWellFormed()).toBe(true);
});
