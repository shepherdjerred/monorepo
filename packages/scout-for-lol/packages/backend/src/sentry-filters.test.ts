import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/bun";
import { z } from "zod";
import { filterScoutSentryEvent } from "#src/sentry-filters.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

function makeHint(originalException: unknown): EventHint {
  return { originalException };
}

const baseEvent: ErrorEvent = {
  type: undefined,
  event_id: "test",
};

function makeRiotError(status: number): RiotHttpError {
  return new RiotHttpError({
    status,
    statusText: "Riot upstream error",
    body: null,
    url: "https://na1.api.riotgames.com/test",
    headers: new Headers(),
  });
}

/**
 * Random function that returns a value just under 1 — always above any
 * realistic sample rate (≤ 0.5), but still in the legal `Math.random()`
 * range of `[0, 1)`. Using exactly 1 would be wrong because `Math.random`
 * never produces it; the test would diverge from production semantics.
 */
const alwaysDrop = (): number => 0.999999;
/** Random function that always returns 0 (below any sample rate > 0). */
const alwaysSample = (): number => 0;

describe("filterScoutSentryEvent — Riot upstream sampling", () => {
  test("drops reviewed Riot upstream failures when not sampled", () => {
    for (const status of [502, 503, 504, 520, 522, 524]) {
      const result = filterScoutSentryEvent(
        baseEvent,
        makeHint(makeRiotError(status)),
        alwaysDrop,
      );
      expect(result).toBeNull();
    }
  });

  test("keeps a Riot upstream failure when sampled", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeRiotError(502)),
      alwaysSample,
    );
    expect(result).toEqual(baseEvent);
  });
});

describe("filterScoutSentryEvent — Riot upstream sample-rate distribution", () => {
  test("at default 1% rate, ~1 in 100 events are kept (10k iterations)", () => {
    let kept = 0;
    const iterations = 10_000;
    for (let i = 0; i < iterations; i++) {
      const result = filterScoutSentryEvent(
        baseEvent,
        makeHint(makeRiotError(502)),
      );
      if (result !== null) {
        kept++;
      }
    }
    // Expected ~100 (1% of 10k); allow a generous binomial margin so the
    // test is not flaky. 3σ for p=0.01, n=10k is ~30, so window 50–160.
    expect(kept).toBeGreaterThan(50);
    expect(kept).toBeLessThan(160);
  });
});

describe("filterScoutSentryEvent — Riot upstream sample-rate env override", () => {
  let originalRate: string | undefined;

  beforeEach(() => {
    originalRate = Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"];
  });
  afterEach(() => {
    if (originalRate === undefined) {
      delete Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"];
    } else {
      Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = originalRate;
    }
  });

  test("env=0 drops every Riot upstream event regardless of random()", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "0";
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeRiotError(502)),
      alwaysSample,
    );
    expect(result).toBeNull();
  });

  test("env=1 keeps every Riot upstream event regardless of random()", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "1";
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeRiotError(502)),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("invalid env value falls back to default 1%", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "not-a-number";
    // alwaysDrop returns 1 which is >= 0.01, so the event drops at default rate.
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeRiotError(502)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });

  test("out-of-range env value falls back to default 1%", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "1.5";
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeRiotError(502)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });
});

describe("filterScoutSentryEvent — keeps non-noise events regardless of sampling", () => {
  test("keeps actionable or unexpected Riot statuses", () => {
    for (const status of [404, 429, 500]) {
      const result = filterScoutSentryEvent(
        baseEvent,
        makeHint(makeRiotError(status)),
        alwaysDrop,
      );
      expect(result).toEqual(baseEvent);
    }
  });

  test("keeps a similarly named third-party error with status 502", () => {
    const thirdPartyError = new Error("Third-party API 502");
    Object.defineProperty(thirdPartyError, "name", { value: "GenericError" });
    Object.defineProperty(thirdPartyError, "status", { value: 502 });

    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(thirdPartyError),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps a plain status-bearing object", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint({ name: "GenericError", status: 502 }),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });
});

describe("filterScoutSentryEvent — Riot ID Zod filter", () => {
  test("drops ZodError with the riotId regex message", () => {
    const schema = z
      .string()
      .regex(
        /^[\p{L}0-9 ]{3,16}#[\p{L}0-9]{3,5}$/u,
        "Riot ID must be in the format <game_name>#<tag_line>",
      );
    const parseResult = schema.safeParse("not a riot id");
    if (parseResult.success) {
      throw new Error("expected parse to fail");
    }

    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(parseResult.error),
    );
    expect(result).toBeNull();
  });

  test("keeps unrelated ZodError (real schema bug, not boundary noise)", () => {
    const schema = z.object({ foo: z.number() });
    const parseResult = schema.safeParse({ foo: "not a number" });
    if (parseResult.success) {
      throw new Error("expected parse to fail");
    }

    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(parseResult.error),
    );
    expect(result).toEqual(baseEvent);
  });
});

describe("filterScoutSentryEvent — passthrough", () => {
  test("keeps generic errors", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(new Error("something else broke")),
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps events with no original exception", () => {
    const result = filterScoutSentryEvent(baseEvent, {});
    expect(result).toEqual(baseEvent);
  });
});
