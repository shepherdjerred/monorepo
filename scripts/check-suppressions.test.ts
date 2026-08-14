import { describe, expect, test } from "bun:test";

import {
  hasSuppressionPattern,
  isPostalBoundaryViolation,
} from "./check-suppressions.ts";

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

describe("isPostalBoundaryViolation", () => {
  test("rejects direct high-level sends outside the report sender", () => {
    expect(
      isPostalBoundaryViolation(
        "packages/temporal/src/activities/other.ts",
        "sendPostalEmail({})",
      ),
    ).toBe(true);
  });

  test("permits the shared sender and Postal adapter tests", () => {
    expect(
      isPostalBoundaryViolation(
        "packages/temporal/src/activities/report-delivery.ts",
        "sendPostalEmail({})",
      ),
    ).toBe(false);
    expect(
      isPostalBoundaryViolation(
        "packages/temporal/src/shared/postal.test.ts",
        "sendPostalEmail({})",
      ),
    ).toBe(false);
    expect(
      isPostalBoundaryViolation(
        String.raw`packages\temporal\src\shared\postal.ts`,
        "sendPostalEmail({})",
      ),
    ).toBe(false);
  });
});
