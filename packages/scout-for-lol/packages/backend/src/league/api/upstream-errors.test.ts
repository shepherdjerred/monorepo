import { describe, expect, test } from "bun:test";
import {
  EXPECTED_UPSTREAM_ERROR_STATUSES,
  extractHttpStatus,
  isExpectedUpstreamError,
} from "#src/league/api/upstream-errors.ts";

describe("isExpectedUpstreamError", () => {
  test("treats standard origin 5xx as expected", () => {
    for (const status of [502, 503, 504]) {
      expect(isExpectedUpstreamError(status)).toBe(true);
    }
  });

  test("treats Cloudflare edge 5xx (520-527, 530) as expected", () => {
    for (const status of [520, 521, 522, 523, 524, 525, 526, 527, 530]) {
      expect(isExpectedUpstreamError(status)).toBe(true);
    }
  });

  test("does not treat client errors or success as upstream errors", () => {
    for (const status of [200, 400, 404, 429, 500, 501, 528, 529]) {
      expect(isExpectedUpstreamError(status)).toBe(false);
    }
  });

  test("undefined is never an expected upstream error", () => {
    expect(isExpectedUpstreamError(undefined)).toBe(false);
  });
});

describe("extractHttpStatus", () => {
  test("reads a numeric status off a twisted GenericError-shaped value", () => {
    expect(extractHttpStatus({ status: 520 })).toBe(520);
  });

  test("coerces a string status (twisted does not strongly type it)", () => {
    expect(extractHttpStatus({ status: "520" })).toBe(520);
  });

  test("returns undefined when no status is present", () => {
    expect(extractHttpStatus({ message: "boom" })).toBeUndefined();
    expect(extractHttpStatus(new Error("boom"))).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });

  test("a Cloudflare 520 flows end-to-end from raw error to expected", () => {
    // Regression: 520s from the Spectator API were flooding Bugsink because
    // they were not classified as expected upstream errors.
    const status = extractHttpStatus({ status: 520 });
    expect(status).toBe(520);
    expect(isExpectedUpstreamError(status)).toBe(true);
    expect(EXPECTED_UPSTREAM_ERROR_STATUSES.has(520)).toBe(true);
  });
});
