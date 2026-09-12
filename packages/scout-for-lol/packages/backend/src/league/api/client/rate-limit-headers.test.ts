import { describe, expect, test } from "vitest";
import { parseAppRateLimitWindows } from "./rate-limit-headers.ts";

describe("parseAppRateLimitWindows", () => {
  test("parses a multi-window header and zips by window, not position", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1,100:120",
      // Deliberately listed in a different order than the limit header.
      "X-App-Rate-Limit-Count": "45:120,3:1",
    });

    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 3, limit: 20 },
      { windowSeconds: 120, count: 45, limit: 100 },
    ]);
  });

  test("parses a single-window header", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1",
      "X-App-Rate-Limit-Count": "5:1",
    });

    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 5, limit: 20 },
    ]);
  });

  test("skips malformed/non-numeric entries instead of throwing", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1,abc:xyz,100:120",
      "X-App-Rate-Limit-Count": "3:1,45:120",
    });

    expect(() => parseAppRateLimitWindows(headers)).not.toThrow();
    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 3, limit: 20 },
      { windowSeconds: 120, count: 45, limit: 100 },
    ]);
  });

  test("returns an empty array when either header is missing", () => {
    const onlyLimit = new Headers({ "X-App-Rate-Limit": "20:1" });
    const onlyCount = new Headers({ "X-App-Rate-Limit-Count": "5:1" });
    const neither = new Headers();

    expect(parseAppRateLimitWindows(onlyLimit)).toEqual([]);
    expect(parseAppRateLimitWindows(onlyCount)).toEqual([]);
    expect(parseAppRateLimitWindows(neither)).toEqual([]);
  });

  test("drops unmatched windows present in only one header", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1,100:120,500:600",
      "X-App-Rate-Limit-Count": "3:1,45:120,9:10",
    });

    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 3, limit: 20 },
      { windowSeconds: 120, count: 45, limit: 100 },
    ]);
  });
});
