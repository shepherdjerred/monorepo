import { describe, expect, test } from "bun:test";

import { hasSuppressionPattern } from "./check-suppressions.ts";

describe("hasSuppressionPattern", () => {
  test("detects ESLint comment directives", () => {
    expect(
      hasSuppressionPattern("// eslint-disable-next-line unicorn/foo"),
    ).toBe(true);
    expect(hasSuppressionPattern("/* eslint-disable */")).toBe(true);
  });

  test("does not mistake an ESLint rule name for a directive", () => {
    expect(hasSuppressionPattern('"no-abusive-eslint-disable",')).toBe(false);
  });

  test("continues to detect non-ESLint suppressions", () => {
    expect(hasSuppressionPattern("// @ts-expect-error")).toBe(true);
    expect(hasSuppressionPattern("command || true")).toBe(true);
  });
});
