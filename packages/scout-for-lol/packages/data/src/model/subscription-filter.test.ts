import { describe, expect, test } from "bun:test";
import {
  SubscriptionFilterSpecSchema,
  filtersPass,
  serializeSubscriptionFilters,
  parseSubscriptionFilters,
  type SubscriptionFilterSpec,
} from "#src/model/subscription-filter.ts";

const soloOnly: SubscriptionFilterSpec = {
  version: 1,
  filters: [{ type: "queue", queues: ["solo"] }],
};

describe("SubscriptionFilterSpecSchema", () => {
  test("accepts a valid queue filter spec", () => {
    expect(SubscriptionFilterSpecSchema.parse(soloOnly)).toEqual(soloOnly);
  });

  test("rejects an empty queues allow-list", () => {
    expect(
      SubscriptionFilterSpecSchema.safeParse({
        version: 1,
        filters: [{ type: "queue", queues: [] }],
      }).success,
    ).toBe(false);
  });

  test("rejects duplicate filter types", () => {
    expect(
      SubscriptionFilterSpecSchema.safeParse({
        version: 1,
        filters: [
          { type: "queue", queues: ["solo"] },
          { type: "queue", queues: ["flex"] },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown version", () => {
    expect(
      SubscriptionFilterSpecSchema.safeParse({ version: 2, filters: [] })
        .success,
    ).toBe(false);
  });
});

describe("filtersPass", () => {
  test("null spec notifies all", () => {
    expect(filtersPass(null, { queueType: "aram" })).toBe(true);
  });

  test("empty filters notifies all", () => {
    expect(
      filtersPass({ version: 1, filters: [] }, { queueType: "aram" }),
    ).toBe(true);
  });

  test("queue filter passes when the queue is in the allow-list", () => {
    expect(filtersPass(soloOnly, { queueType: "solo" })).toBe(true);
  });

  test("queue filter fails when the queue is not in the allow-list", () => {
    expect(filtersPass(soloOnly, { queueType: "aram" })).toBe(false);
  });

  test("an unknown queue fails a queue filter (fail-closed)", () => {
    expect(filtersPass(soloOnly, { queueType: undefined })).toBe(false);
  });

  test("multi-queue allow-list matches any listed queue", () => {
    const ranked: SubscriptionFilterSpec = {
      version: 1,
      filters: [{ type: "queue", queues: ["solo", "flex"] }],
    };
    expect(filtersPass(ranked, { queueType: "flex" })).toBe(true);
    expect(filtersPass(ranked, { queueType: "solo" })).toBe(true);
    expect(filtersPass(ranked, { queueType: "aram" })).toBe(false);
  });
});

describe("serialize / parse round-trip", () => {
  test("serializeSubscriptionFilters -> parseSubscriptionFilters yields the same spec", () => {
    const serialized = serializeSubscriptionFilters(soloOnly);
    expect(parseSubscriptionFilters(serialized)).toEqual(soloOnly);
  });

  test("the serialized value is the JSON that lands in the column", () => {
    expect(serializeSubscriptionFilters(soloOnly).toString()).toBe(
      JSON.stringify(soloOnly),
    );
  });
});

describe("parseSubscriptionFilters is fail-open", () => {
  test("null / empty raw yields null (notify all)", () => {
    const missing: string | undefined = undefined;
    expect(parseSubscriptionFilters(null)).toBeNull();
    expect(parseSubscriptionFilters(missing)).toBeNull();
    expect(parseSubscriptionFilters("")).toBeNull();
    expect(parseSubscriptionFilters("   ")).toBeNull();
  });

  test("malformed JSON yields null rather than throwing", () => {
    expect(parseSubscriptionFilters("{not json")).toBeNull();
  });

  test("structurally-invalid JSON yields null", () => {
    expect(
      parseSubscriptionFilters('{"version":1,"filters":"nope"}'),
    ).toBeNull();
    expect(
      parseSubscriptionFilters(
        JSON.stringify({
          version: 1,
          filters: [{ type: "unknown-dimension", foo: 1 }],
        }),
      ),
    ).toBeNull();
  });
});
