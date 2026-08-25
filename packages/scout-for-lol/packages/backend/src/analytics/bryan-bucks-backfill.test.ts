import { describe, expect, test } from "vitest";
import { deterministicBucksAnalyticsEventId } from "#src/analytics/bryan-bucks-backfill.ts";

describe("Bryan Bucks analytics backfill IDs", () => {
  test("is stable for the same source row and transition", () => {
    const first = deterministicBucksAnalyticsEventId("pool", 42, "settled");
    const second = deterministicBucksAnalyticsEventId("pool", 42, "settled");

    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("separates different source rows and transitions", () => {
    expect(deterministicBucksAnalyticsEventId("pool", 42, "opened")).not.toBe(
      deterministicBucksAnalyticsEventId("pool", 42, "settled"),
    );
    expect(deterministicBucksAnalyticsEventId("pool", 42)).not.toBe(
      deterministicBucksAnalyticsEventId("pool", 43),
    );
  });
});
