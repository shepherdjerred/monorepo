import { describe, expect, test } from "vitest";
import {
  formatClashInstant,
  formatClashIso,
  phaseLabel,
  sightingOutcomeLabel,
  titleCaseToken,
} from "#src/routes/consumer/consumer-clash-copy.ts";

describe("Clash copy helpers", () => {
  test("title-cases Riot role tokens", () => {
    expect(titleCaseToken("CAPTAIN")).toBe("Captain");
    expect(titleCaseToken("FILL")).toBe("Fill");
    expect(titleCaseToken("TOP")).toBe("Top");
  });

  test("formats missing Clash instants as an em dash", () => {
    expect(formatClashInstant(0)).toBe("—");
    expect(formatClashInstant(Number.NaN)).toBe("—");
  });

  test("labels cancelled, open, started, and upcoming phases", () => {
    const registrationTime = Date.parse("2026-09-19T17:00:00.000Z");
    const startTime = Date.parse("2026-09-20T17:00:00.000Z");
    expect(
      phaseLabel({
        cancelled: true,
        registrationTime,
        startTime,
        now: registrationTime,
      }),
    ).toBe("Cancelled");
    expect(
      phaseLabel({
        cancelled: false,
        registrationTime,
        startTime,
        now: registrationTime,
      }),
    ).toBe("Registration open");
    expect(
      phaseLabel({
        cancelled: false,
        registrationTime,
        startTime,
        now: startTime,
      }),
    ).toBe("Started");
    expect(
      phaseLabel({
        cancelled: false,
        registrationTime,
        startTime,
        now: registrationTime - 1,
      }),
    ).toBe("Upcoming");
  });

  test("formats Clash ISO instants and labels lobby versus scored leftovers", () => {
    expect(formatClashIso("not-a-date")).toBe("—");
    expect(sightingOutcomeLabel("lobby")).toBe("Lobby only");
    expect(sightingOutcomeLabel("win")).toBe("Win · scored through Feb 2026");
    expect(sightingOutcomeLabel("loss")).toBe("Loss · scored through Feb 2026");
  });
});
