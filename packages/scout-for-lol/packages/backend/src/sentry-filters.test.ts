import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ErrorEvent, EventHint } from "@sentry/bun";
import { z } from "zod";
import { filterScoutSentryEvent } from "#src/sentry-filters.ts";

function makeHint(originalException: unknown): EventHint {
  return { originalException };
}

const baseEvent: ErrorEvent = {
  type: undefined,
  event_id: "test",
};

/**
 * Build a fake twisted error with the given runtime `name` and `status`.
 * Twisted's real classes set `name` on the prototype; we replicate that
 * shape rather than importing twisted directly so the test is decoupled
 * from the upstream dep version.
 */
function makeTwistedError(name: string, status: number | string): Error {
  const error = new Error("twisted-shaped error");
  Object.defineProperty(error, "name", { value: name });
  Object.defineProperty(error, "status", { value: status });
  return error;
}

/**
 * Random function that returns a value just under 1 — always above any
 * realistic sample rate (≤ 0.5), but still in the legal `Math.random()`
 * range of `[0, 1)`. Using exactly 1 would be wrong because `Math.random`
 * never produces it; the test would diverge from production semantics.
 */
const alwaysDrop = (): number => 0.999_999;
/** Random function that always returns 0 (below any sample rate > 0). */
const alwaysSample = (): number => 0;

describe("filterScoutSentryEvent — twisted upstream sampling (above sample threshold)", () => {
  test("drops twisted GenericError 502 when not sampled", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 502)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });

  test("drops twisted GenericError 504 when not sampled", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 504)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });

  test("drops twisted RiotUnavailable 503 when not sampled", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("RiotUnavailable", 503)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });
});

describe("filterScoutSentryEvent — twisted upstream sampling (below sample threshold)", () => {
  test("keeps twisted GenericError 502 when sampled", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 502)),
      alwaysSample,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps twisted RiotUnavailable 503 when sampled", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("RiotUnavailable", 503)),
      alwaysSample,
    );
    expect(result).toEqual(baseEvent);
  });
});

describe("filterScoutSentryEvent — twisted upstream sample-rate distribution", () => {
  test("at default 1% rate, ~1 in 100 events are kept (10k iterations)", () => {
    let kept = 0;
    const iterations = 10_000;
    for (let i = 0; i < iterations; i++) {
      const result = filterScoutSentryEvent(
        baseEvent,
        makeHint(makeTwistedError("GenericError", 502)),
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

describe("filterScoutSentryEvent — twisted upstream sample-rate env override", () => {
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

  test("env=0 drops every twisted upstream event regardless of random()", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "0";
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 502)),
      alwaysSample,
    );
    expect(result).toBeNull();
  });

  test("env=1 keeps every twisted upstream event regardless of random()", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "1";
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 502)),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("invalid env value falls back to default 1%", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "not-a-number";
    // alwaysDrop returns 1 which is >= 0.01, so the event drops at default rate.
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 502)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });

  test("out-of-range env value falls back to default 1%", () => {
    Bun.env["SCOUT_RIOT_5XX_SAMPLE_RATE"] = "1.5";
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 502)),
      alwaysDrop,
    );
    expect(result).toBeNull();
  });
});

describe("filterScoutSentryEvent — keeps non-noise events regardless of sampling", () => {
  test("keeps twisted GenericError with status 429 (rate limit, actionable)", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 429)),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps twisted GenericError with status 404", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 404)),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps twisted GenericError with status 500 (real Riot bug)", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", 500)),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps twisted GenericError with non-numeric status (defensive)", () => {
    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(makeTwistedError("GenericError", "502")),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps NON-twisted error with status 502 (e.g. Discord, Bugsink, OpenAI)", () => {
    // Critical regression guard: only twisted's own error classes are subject
    // to sampling. A 502 from any other source still pages.
    const discordishError = new Error("Discord API 502");
    Object.defineProperty(discordishError, "name", {
      value: "DiscordAPIError",
    });
    Object.defineProperty(discordishError, "status", { value: 502 });

    const result = filterScoutSentryEvent(
      baseEvent,
      makeHint(discordishError),
      alwaysDrop,
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps plain object with status 502 (not an Error instance)", () => {
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
