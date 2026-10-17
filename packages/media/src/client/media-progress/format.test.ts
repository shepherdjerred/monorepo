import { expect, test } from "vitest";
import { downloadPercent, seededDuration } from "./format.ts";

test("an almost complete download is not presented as complete", () => {
  expect(downloadPercent(0)).toBe("0%");
  expect(downloadPercent(0.427)).toBe("42%");
  expect(downloadPercent(0.99999)).toBe("99%");
  expect(downloadPercent(1)).toBe("100%");
  expect(() => downloadPercent(Number.NaN)).toThrow(
    "Invalid download progress",
  );
});

test("observed seeding time keeps the seven-day boundary honest", () => {
  expect(seededDuration(59)).toBe("Less than a minute");
  expect(seededDuration(3600)).toBe("1 hour");
  expect(seededDuration(7 * 86_400 - 1)).toBe("6 days 23 hours");
  expect(seededDuration(7 * 86_400)).toBe("7 days");
  expect(() => seededDuration(-1)).toThrow("Invalid seeding duration");
});
