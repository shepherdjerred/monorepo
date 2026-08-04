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

  test("treats Cloudflare edge/connectivity 5xx (520, 522, 524) as expected", () => {
    for (const status of [520, 522, 524]) {
      expect(isExpectedUpstreamError(status)).toBe(true);
    }
  });

  test("does not treat client errors, success, unevidenced Cloudflare edge codes, certificate failures, or ambiguous 530 as upstream errors", () => {
    // 521/523/527 are nominally part of the same Cloudflare edge 5xx family,
    // but each can equally reflect a persistent origin firewall, DNS/routing,
    // or Railgun configuration failure rather than a brief outage; the
    // incident evidence backing this classification (Bugsink sampling)
    // establishes repeated 520s only. 525/526 are Cloudflare TLS
    // handshake/certificate failures, which are typically a persistent origin
    // misconfiguration rather than a transient edge condition. 530 wraps the
    // whole Cloudflare Error 1xxx range (rate limiting, access denial, …); the
    // status alone cannot establish a transient origin outage. All stay
    // unexpected and remain visible in error tracking.
    for (const status of [
      200, 400, 404, 429, 500, 501, 521, 523, 525, 526, 527, 528, 529, 530,
    ]) {
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
