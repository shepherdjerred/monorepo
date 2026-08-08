import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, test } from "bun:test";

import {
  addDuration,
  epochNanosecondsToInstantText,
  instantTextToEpochNanoseconds,
  InstantTextSchema,
} from "#shared/time";

describe("Temporal boundary", () => {
  test("round trips epoch nanoseconds without precision loss", () => {
    const instant = InstantTextSchema.parse("2026-08-08T12:34:56.123456789Z");
    expect(
      epochNanosecondsToInstantText(instantTextToEpochNanoseconds(instant)),
    ).toBe(instant);
  });

  test("duration arithmetic is independent of local DST", () => {
    const before = Temporal.ZonedDateTime.from(
      "2026-03-08T01:30:00-08:00[America/Los_Angeles]",
    ).toInstant();
    const after = addDuration(before.epochNanoseconds, { hours: 2 });
    expect(
      Temporal.Instant.fromEpochNanoseconds(after)
        .since(before)
        .total({ unit: "hours" }),
    ).toBe(2);
  });

  test("rejects timestamps without an offset", () => {
    expect(() => InstantTextSchema.parse("2026-08-08T12:00:00")).toThrow();
  });
});
