import { describe, expect, test } from "vitest";
import { stormResetNotice } from "./storm-reset-notice.ts";

const reset = new Date("2027-01-01T13:15:00Z");
const hoursBefore = (hours: number) =>
  new Date(reset.getTime() - hours * 3_600_000);

describe("stormResetNotice", () => {
  test("warns a week ahead and the day before, once each", () => {
    expect(stormResetNotice(hoursBefore(164), reset, false)).toEqual({
      kind: "week",
      content:
        "The mining world resets in a week (2027-01-01). Anything left there will be gone.",
      nonce: "rst-2027-01-01-week",
    });
    expect(stormResetNotice(hoursBefore(140), reset, false)).toBeNull();
    expect(stormResetNotice(hoursBefore(20), reset, false)?.kind).toBe(
      "tomorrow",
    );
    expect(stormResetNotice(hoursBefore(44), reset, false)).toBeNull();
  });

  test("never announces a paused or unknown reset", () => {
    expect(stormResetNotice(hoursBefore(20), reset, true)).toBeNull();
    expect(stormResetNotice(hoursBefore(20), undefined, false)).toBeNull();
  });

  test("nonces fit Discord's limit", () => {
    const notice = stormResetNotice(hoursBefore(20), reset, false);
    expect(notice?.nonce.length).toBeLessThanOrEqual(25);
  });
});
