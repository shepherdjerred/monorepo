import { describe, expect, test } from "bun:test";
import { describeSubscriptionFilters } from "@scout-for-lol/data/index.ts";
import {
  parseQueuesArg,
  suggestQueueCompletions,
} from "#src/discord/commands/subscription/queue-filter-arg.ts";

describe("parseQueuesArg", () => {
  test("empty / whitespace / missing => null (notify all)", () => {
    const missing: string | undefined = undefined;
    expect(parseQueuesArg(missing)).toEqual({ ok: true, spec: null });
    expect(parseQueuesArg("")).toEqual({ ok: true, spec: null });
    expect(parseQueuesArg("   ")).toEqual({ ok: true, spec: null });
  });

  test("parses a comma-separated list into a queue filter", () => {
    expect(parseQueuesArg("solo, flex")).toEqual({
      ok: true,
      spec: {
        version: 1,
        filters: [{ type: "queue", queues: ["solo", "flex"] }],
      },
    });
  });

  test("is case-insensitive and dedupes", () => {
    expect(parseQueuesArg("SOLO, solo, Flex")).toEqual({
      ok: true,
      spec: {
        version: 1,
        filters: [{ type: "queue", queues: ["solo", "flex"] }],
      },
    });
  });

  test("accepts multi-word queue names", () => {
    expect(parseQueuesArg("draft pick, aram clash")).toEqual({
      ok: true,
      spec: {
        version: 1,
        filters: [{ type: "queue", queues: ["draft pick", "aram clash"] }],
      },
    });
  });

  test("collects unknown tokens as invalid", () => {
    expect(parseQueuesArg("solo, bogus, nope")).toEqual({
      ok: false,
      invalid: ["bogus", "nope"],
    });
  });
});

describe("suggestQueueCompletions", () => {
  test("suggests queues matching the current segment", () => {
    const suggestions = suggestQueueCompletions("ar");
    expect(suggestions.length).toBeGreaterThan(0);
    // every value is a raw queue token (matches parseQueuesArg's expectations)
    for (const s of suggestions) {
      expect(parseQueuesArg(s.value).ok).toBe(true);
    }
  });

  test("appends to an already-typed list and excludes chosen queues", () => {
    const suggestions = suggestQueueCompletions("solo, fl");
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.value.startsWith("solo, ")).toBe(true);
      expect(s.value).not.toBe("solo, solo");
    }
  });

  test("respects Discord's 25-choice cap", () => {
    expect(suggestQueueCompletions("").length).toBeLessThanOrEqual(25);
  });
});

describe("describeSubscriptionFilters", () => {
  test("null => all queues", () => {
    expect(describeSubscriptionFilters(null)).toBe("all queues");
  });

  test("renders a queue filter via display names", () => {
    expect(
      describeSubscriptionFilters({
        version: 1,
        filters: [{ type: "queue", queues: ["solo", "flex"] }],
      }),
    ).toBe("ranked solo, ranked flex");
  });
});
