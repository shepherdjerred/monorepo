import { describe, expect, test } from "vitest";
import {
  EXPECTED_UPSTREAM_STATUS_CODES,
  extractHttpStatus,
  isExpectedUpstreamError,
  RiotHttpError,
} from "./errors.ts";

function riotError(status: number): RiotHttpError {
  return new RiotHttpError({
    status,
    statusText: "Upstream error",
    body: undefined,
    url: "https://na1.api.riotgames.com/test",
    headers: new Headers(),
  });
}

describe("isExpectedUpstreamError", () => {
  test("treats reviewed Riot origin and Cloudflare failures as expected", () => {
    for (const status of [502, 503, 504, 520, 522, 524]) {
      expect(isExpectedUpstreamError(status)).toBe(true);
    }
  });

  test("keeps other client, origin, and Cloudflare failures visible", () => {
    for (const status of [
      200, 400, 404, 429, 500, 501, 521, 523, 525, 526, 527, 528, 529, 530,
    ]) {
      expect(isExpectedUpstreamError(status)).toBe(false);
    }
    expect(isExpectedUpstreamError(undefined)).toBe(false);
  });
});

describe("extractHttpStatus", () => {
  test("reads the status from RiotHttpError", () => {
    expect(extractHttpStatus(riotError(520))).toBe(520);
  });

  test("does not classify similarly shaped third-party errors", () => {
    expect(extractHttpStatus({ status: 520 })).toBeUndefined();
    expect(extractHttpStatus({ status: "520" })).toBeUndefined();
    expect(extractHttpStatus(new Error("boom"))).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });

  test("a Riot Cloudflare 520 flows into the expected-error policy", () => {
    const status = extractHttpStatus(riotError(520));
    expect(status).toBe(520);
    expect(isExpectedUpstreamError(status)).toBe(true);
    expect(EXPECTED_UPSTREAM_STATUS_CODES.has(520)).toBe(true);
  });
});
