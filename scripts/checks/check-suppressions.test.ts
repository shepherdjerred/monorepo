import { describe, expect, test } from "vitest";

import {
  hasSuppressionPattern,
  isMailBoundaryViolation,
  staleExclusions,
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

  test("detects Java suppressions", () => {
    expect(hasSuppressionPattern('@SuppressWarnings("NullAway")')).toBe(true);
    expect(hasSuppressionPattern("int x = 1; // NOPMD")).toBe(true);
    expect(hasSuppressionPattern("// CHECKSTYLE:OFF")).toBe(true);
    expect(hasSuppressionPattern("SuppressWarnings are banned")).toBe(false);
  });

  test("continues to detect non-ESLint suppressions", () => {
    expect(hasSuppressionPattern("// @ts-expect-error")).toBe(true);
    expect(hasSuppressionPattern("command || true")).toBe(true);
  });
});

describe("isMailBoundaryViolation", () => {
  test("rejects direct high-level sends outside the report sender", () => {
    expect(
      isMailBoundaryViolation(
        "packages/temporal/src/activities/other.ts",
        "sendMailEmail({})",
      ),
    ).toBe(true);
  });

  test("permits the shared sender and Mail adapter tests", () => {
    expect(
      isMailBoundaryViolation(
        "packages/temporal/src/activities/reports/report-delivery.ts",
        "sendMailEmail({})",
      ),
    ).toBe(false);
    expect(
      isMailBoundaryViolation(
        "packages/temporal/src/shared/infra/mail.test.ts",
        "sendMailEmail({})",
      ),
    ).toBe(false);
    expect(
      isMailBoundaryViolation(
        String.raw`packages\temporal\src\shared\infra\mail.ts`,
        "sendMailEmail({})",
      ),
    ).toBe(false);
  });
});

describe("staleExclusions", () => {
  test("reports every exclusion when nothing is tracked", () => {
    expect(staleExclusions([])).toContain("scripts/prompts/");
  });

  test("keeps a prefix exclusion alive through any file beneath it", () => {
    expect(staleExclusions(["scripts/prompts/refine.md"])).not.toContain(
      "scripts/prompts/",
    );
  });

  test("keeps a basename exclusion alive through a nested match", () => {
    expect(staleExclusions(["packages/x/AGENTS.md"])).not.toContain(
      "AGENTS.md",
    );
  });
});
