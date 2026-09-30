import { describe, expect, test } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/bun";
import { filterBirmelSentryEvent } from "./sentry-filters.ts";

const baseEvent: ErrorEvent = {
  type: undefined,
  event_id: "test",
};

function makeHint(originalException: unknown): EventHint {
  return { originalException };
}

function discordHttpError(name: string, status: number): Error {
  return Object.assign(new Error("Internal Server Error"), { name, status });
}

describe("filterBirmelSentryEvent", () => {
  test.each(["DiscordAPIError", "HTTPError"])(
    "drops a retried 5xx %s",
    (name) => {
      const result = filterBirmelSentryEvent(
        baseEvent,
        makeHint(discordHttpError(name, 500)),
      );
      expect(result).toBeNull();
    },
  );

  test("keeps 4xx Discord errors", () => {
    const result = filterBirmelSentryEvent(
      baseEvent,
      makeHint(discordHttpError("DiscordAPIError", 404)),
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps non-HTTP errors", () => {
    const result = filterBirmelSentryEvent(
      baseEvent,
      makeHint(new Error("boom")),
    );
    expect(result).toEqual(baseEvent);
  });
});
