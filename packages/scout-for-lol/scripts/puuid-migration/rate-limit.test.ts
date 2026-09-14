import { describe, expect, test } from "vitest";
import {
  BUDGET_FRACTION,
  minutesFor,
  parseRateLimitHeader,
  RateLimiter,
} from "./rate-limit.ts";

describe("parseRateLimitHeader", () => {
  test("scales every window to the budget", () => {
    // The old key's real header, measured 2026-09-13.
    expect(parseRateLimitHeader("100:120,20:1", "app")).toEqual([
      { limit: 80, seconds: 120, scope: "app" },
      { limit: 16, seconds: 1, scope: "app" },
    ]);
  });

  test("scales the production key's windows", () => {
    expect(parseRateLimitHeader("500:10,30000:600", "app")).toEqual([
      { limit: 400, seconds: 10, scope: "app" },
      { limit: 24_000, seconds: 600, scope: "app" },
    ]);
  });

  test("never scales a window below one request", () => {
    // Zero would deadlock rather than throttle.
    expect(parseRateLimitHeader("1:60", "app")).toEqual([
      { limit: 1, seconds: 60, scope: "app" },
    ]);
  });

  test("refuses a header it cannot read rather than guessing", () => {
    expect(() => parseRateLimitHeader("100/120", "app")).toThrow(/Unparseable/);
    expect(() => parseRateLimitHeader("", "app")).toThrow(/no windows/);
    expect(() => parseRateLimitHeader("0:120", "app")).toThrow(/non-positive/);
  });

  test("the budget is a fraction, not the whole limit", () => {
    expect(BUDGET_FRACTION).toBeLessThan(1);
  });
});

const perSecond = (w: { limit: number; seconds: number }): number =>
  w.limit / w.seconds;

describe("the tightest window wins", () => {
  test("account-v1's method limit binds before the production app limit", () => {
    // The trap this exists to catch: the app header alone would permit 50/s,
    // and account-v1 will not.
    const app = parseRateLimitHeader("500:10,30000:600", "app");
    const method = parseRateLimitHeader("1000:60", "method");
    expect(Math.min(...app.map((w) => perSecond(w)))).toBe(40);
    expect(Math.min(...method.map((w) => perSecond(w)))).toBeCloseTo(13.33, 1);
  });
});

describe("RateLimiter", () => {
  test("hands out slots up to the window and then blocks", async () => {
    const limiter = new RateLimiter("test", [
      { limit: 3, seconds: 60, scope: "app" },
    ]);
    const started = Date.now();
    await limiter.take();
    await limiter.take();
    await limiter.take();
    // Three fit immediately; a fourth cannot, so stop before it blocks for a
    // minute and assert the first three were free.
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("adopts the limits a key actually reports", () => {
    const limiter = new RateLimiter("test", [
      { limit: 999, seconds: 1, scope: "app" },
    ]);
    limiter.adopt("100:120,20:1", "1000:60");
    expect(limiter.windows).toEqual([
      { limit: 80, seconds: 120, scope: "app" },
      { limit: 16, seconds: 1, scope: "app" },
      { limit: 800, seconds: 60, scope: "method" },
    ]);
  });

  test("adopts once, so a later response cannot loosen the budget", () => {
    const limiter = new RateLimiter("test", [
      { limit: 999, seconds: 1, scope: "app" },
    ]);
    limiter.adopt("100:120", null);
    limiter.adopt("30000:600", null);
    expect(limiter.windows).toEqual([
      { limit: 80, seconds: 120, scope: "app" },
    ]);
  });

  test("keeps the bootstrap budget when a response carries no header", () => {
    const limiter = new RateLimiter("test", [
      { limit: 7, seconds: 1, scope: "app" },
    ]);
    limiter.adopt(null, null);
    expect(limiter.windows).toEqual([{ limit: 7, seconds: 1, scope: "app" }]);
  });
});

describe("minutesFor", () => {
  test("estimates from the binding window", () => {
    // 240k identities against the old key's 80-per-120s budget.
    expect(
      minutesFor(240_000, parseRateLimitHeader("100:120,20:1", "app")),
    ).toBe(6000);
  });

  test("uses the method window when it is the tighter one", () => {
    const windows = [
      ...parseRateLimitHeader("500:10,30000:600", "app"),
      ...parseRateLimitHeader("1000:60", "method"),
    ];
    // 800 per 60s, not 400 per 10s.
    expect(minutesFor(240_000, windows)).toBe(300);
  });
});

describe("sharing a key with live traffic", () => {
  test("yields its budget to whatever else is using the key", async () => {
    // The old key still serves Scout's own polling until the backends are
    // scaled down. `X-App-Rate-Limit-Count` is app-wide, so the budget is a
    // ceiling on TOTAL usage: what others have spent comes out of ours, rather
    // than the migration spending it all and leaving them the 429s.
    const limiter = new RateLimiter("shared", [
      { limit: 4, seconds: 60, scope: "app" },
    ]);
    limiter.observeUsage("4:60", null);
    const started = Date.now();
    const race = await Promise.race([
      limiter.take().then(() => "took"),
      Bun.sleep(300).then(() => "blocked"),
    ]);
    expect(race).toBe("blocked");
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  test("yields the method window to other callers too", async () => {
    // The regression this guards: usage was read only from the app count and
    // stored by window length, so the method window — `1000:60` on the
    // production key, and the one that actually binds there — looked for a
    // 60-second app window, found none, and concluded nobody else was using
    // it. Live Account-V1 traffic was invisible in exactly the window most
    // likely to exhaust first.
    const limiter = new RateLimiter("shared", [
      { limit: 400, seconds: 10, scope: "app" },
      { limit: 4, seconds: 60, scope: "method" },
    ]);
    limiter.observeUsage("1:10", "4:60");
    const started = Date.now();
    const race = await Promise.race([
      limiter.take().then(() => "took"),
      Bun.sleep(300).then(() => "blocked"),
    ]);
    expect(race).toBe("blocked");
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  test("keeps app and method usage apart when windows share a length", async () => {
    // Same length, different scope. Credited to one another these would double
    // count and stall a limiter that in fact has room in both.
    const limiter = new RateLimiter("shared", [
      { limit: 4, seconds: 60, scope: "app" },
      { limit: 4, seconds: 60, scope: "method" },
    ]);
    limiter.observeUsage("2:60", "1:60");
    const started = Date.now();
    await limiter.take();
    await limiter.take();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("uses the headroom others leave", async () => {
    const limiter = new RateLimiter("shared", [
      { limit: 10, seconds: 60, scope: "app" },
    ]);
    limiter.observeUsage("2:60", null);
    // Eight slots remain; taking a few must not block.
    const started = Date.now();
    await limiter.take();
    await limiter.take();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("ignores an observation older than the window it describes", async () => {
    // The count decays as the window rolls. Trusting a stale one would stall
    // this process against traffic that has long since aged out.
    const limiter = new RateLimiter("shared", [
      { limit: 2, seconds: 1, scope: "app" },
    ]);
    limiter.observeUsage("2:1", null);
    await Bun.sleep(1100);
    const started = Date.now();
    await limiter.take();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("a response with no count header changes nothing", async () => {
    const limiter = new RateLimiter("shared", [
      { limit: 3, seconds: 60, scope: "app" },
    ]);
    limiter.observeUsage(null, null);
    const started = Date.now();
    await limiter.take();
    expect(Date.now() - started).toBeLessThan(200);
  });
});
