import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  digestMessageId,
  digestPeriod,
  digestPeriodKey,
} from "#domain/ops-period";

describe("digest period keys", () => {
  it("keys the daily digest by the Los Angeles calendar date", () => {
    // 06:30Z on the 24th is still the 23rd in Los Angeles (PDT, UTC-7).
    expect(
      digestPeriodKey("daily", Temporal.Instant.from("2026-09-24T06:30:00Z")),
    ).toBe("2026-09-23");
    expect(
      digestPeriodKey("daily", Temporal.Instant.from("2026-09-24T14:30:00Z")),
    ).toBe("2026-09-24");
  });

  it("keys the weekly digest by ISO week, including the year boundary", () => {
    expect(
      digestPeriodKey("weekly", Temporal.Instant.from("2026-09-28T15:00:00Z")),
    ).toBe("2026-W40");
    // Monday 2027-01-04 08:00 PST is ISO week 1 of 2027; Friday 2027-01-01
    // still belongs to 2026-W53.
    expect(
      digestPeriodKey("weekly", Temporal.Instant.from("2027-01-04T16:00:00Z")),
    ).toBe("2027-W01");
    expect(
      digestPeriodKey("weekly", Temporal.Instant.from("2027-01-01T20:00:00Z")),
    ).toBe("2026-W53");
  });

  it("retries later the same day map to the same key", () => {
    const first = digestPeriod(
      "daily",
      Temporal.Instant.from("2026-09-24T14:30:00Z"),
    );
    const retry = digestPeriod(
      "daily",
      Temporal.Instant.from("2026-09-24T18:10:00Z"),
    );
    expect(retry.key).toBe(first.key);
    expect(first.end.since(first.start).total({ unit: "hours" })).toBe(24);
    expect(digestMessageId("daily", first.key)).toBe(
      "<ops-digest-daily-2026-09-24@sjer.red>",
    );
  });
});
