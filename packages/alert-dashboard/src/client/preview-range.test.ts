import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { occurrencePreviewRange } from "./preview-range.ts";
import { InstantTextSchema } from "#shared/time";

describe("occurrence preview range", () => {
  const now = Temporal.Instant.from("2026-08-10T12:00:00Z");

  it("anchors a historical preview around the resolved lifecycle", () => {
    expect(
      occurrencePreviewRange(
        {
          openedAt: InstantTextSchema.parse("2026-08-08T18:00:00Z"),
          resolvedAt: InstantTextSchema.parse("2026-08-08T19:00:00Z"),
        },
        now,
      ),
    ).toEqual({
      from: InstantTextSchema.parse("2026-08-08T17:55:00Z"),
      to: InstantTextSchema.parse("2026-08-08T19:05:00Z"),
    });
  });

  it("caps a long resolved lifecycle at the final 24 hours", () => {
    expect(
      occurrencePreviewRange(
        {
          openedAt: InstantTextSchema.parse("2026-08-01T18:00:00Z"),
          resolvedAt: InstantTextSchema.parse("2026-08-08T19:00:00Z"),
        },
        now,
      ),
    ).toEqual({
      from: InstantTextSchema.parse("2026-08-07T19:05:00Z"),
      to: InstantTextSchema.parse("2026-08-08T19:05:00Z"),
    });
  });

  it("keeps an old active lifecycle on a rolling 24-hour window", () => {
    expect(
      occurrencePreviewRange(
        {
          openedAt: InstantTextSchema.parse("2026-08-01T18:00:00Z"),
          resolvedAt: null,
        },
        now,
      ),
    ).toEqual({
      from: InstantTextSchema.parse("2026-08-09T12:00:00Z"),
      to: InstantTextSchema.parse("2026-08-10T12:00:00Z"),
    });
  });
});
