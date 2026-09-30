import { describe, expect, test } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/bun";
import { filterStarlightSentryEvent } from "#src/sentry-filters.ts";

const baseEvent: ErrorEvent = {
  type: undefined,
  event_id: "test",
};

function makeHint(originalException: unknown): EventHint {
  return { originalException };
}

function taggedEvent(source: string): ErrorEvent {
  return { ...baseEvent, tags: { source } };
}

const GATEWAY_MESSAGE =
  "WebSocket connection to 'wss://gateway.discord.gg/?v=10&encoding=json' failed: Expected 101 status code";

describe("filterStarlightSentryEvent", () => {
  test.each(["discord-client", "discord-shard"])(
    "drops gateway noise from the %s handler",
    (source) => {
      const result = filterStarlightSentryEvent(
        taggedEvent(source),
        makeHint(new Error(GATEWAY_MESSAGE)),
      );
      expect(result).toBeNull();
    },
  );

  test("keeps the same message without a Discord handler tag", () => {
    const result = filterStarlightSentryEvent(
      baseEvent,
      makeHint(new Error(GATEWAY_MESSAGE)),
    );
    expect(result).toEqual(baseEvent);
  });

  test("keeps non-handshake errors from the Discord handlers", () => {
    const event = taggedEvent("discord-shard");
    const result = filterStarlightSentryEvent(
      event,
      makeHint(new Error("something else broke")),
    );
    expect(result).toEqual(event);
  });
});
