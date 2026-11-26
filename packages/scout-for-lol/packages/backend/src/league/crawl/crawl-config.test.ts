import { describe, expect, test } from "vitest";
import {
  CRAWL_COOLDOWN_DAYS,
  CRAWL_MAX_DEPTH,
  CRAWL_TIMELINE_PERCENT,
  crawlCooldownEnd,
  crawlLookbackStart,
  crawlTickMatchAllowance,
  puuidHash,
  shouldSampleTimeline,
  utcDayKey,
  utcDayStart,
} from "./crawl-config.ts";

describe("crawl rules", () => {
  test("keep the plan's constants", () => {
    expect(CRAWL_MAX_DEPTH).toBe(2);
    expect(CRAWL_COOLDOWN_DAYS).toBe(7);
    expect(CRAWL_TIMELINE_PERCENT).toBe(20);
  });

  test("look back 28 days and cool down 7", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    expect(crawlLookbackStart(now).toISOString()).toBe(
      "2026-10-17T12:00:00.000Z",
    );
    expect(crawlCooldownEnd(now).toISOString()).toBe(
      "2026-11-21T12:00:00.000Z",
    );
  });

  test("count budget by UTC day", () => {
    const now = new Date("2026-11-14T23:59:59Z");
    expect(utcDayStart(now).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(utcDayKey(now)).toBe("2026-11-14");
  });

  test("pace a tick as the remaining budget over the ticks left in the UTC day", () => {
    const midnight = new Date("2026-11-14T00:00:00Z");
    // 1440 ticks left: 1000 spreads to one match a tick.
    expect(crawlTickMatchAllowance(1000, midnight)).toBe(1);
    expect(crawlTickMatchAllowance(55_000, midnight)).toBe(39);
    // Noon, half the day left: what remains is spread over 720 ticks.
    const noon = new Date("2026-11-14T12:00:00Z");
    expect(crawlTickMatchAllowance(7200, noon)).toBe(10);
    // The last minute may spend everything left.
    const lastMinute = new Date("2026-11-14T23:59:30Z");
    expect(crawlTickMatchAllowance(500, lastMinute)).toBe(500);
    expect(crawlTickMatchAllowance(0, noon)).toBe(0);
    expect(crawlTickMatchAllowance(-3, noon)).toBe(0);
  });

  test("a day of paced ticks spends the budget evenly and never more", () => {
    const budget = 5500;
    let spent = 0;
    let firstHour = 0;
    for (let minute = 0; minute < 1440; minute += 1) {
      const now = new Date(Date.UTC(2026, 10, 14, 0, minute));
      const allowance = crawlTickMatchAllowance(budget - spent, now);
      spent += allowance;
      if (minute < 60) firstHour += allowance;
    }
    expect(spent).toBe(budget);
    expect(firstHour).toBeLessThanOrEqual(Math.ceil(budget / 24) + 60);
  });

  test("hash a PUUID to 64 lowercase hex characters", () => {
    expect(puuidHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("timeline sampling", () => {
  test("is deterministic per match", () => {
    for (const id of ["NA1_1", "EUW1_22", "KR_333"]) {
      expect(shouldSampleTimeline(id)).toBe(shouldSampleTimeline(id));
    }
  });

  test("samples about 20% of matches", () => {
    let sampled = 0;
    const total = 5000;
    for (let index = 0; index < total; index += 1) {
      if (shouldSampleTimeline(`NA1_${(5_000_000_000 + index).toString()}`)) {
        sampled += 1;
      }
    }
    expect(sampled / total).toBeGreaterThan(0.17);
    expect(sampled / total).toBeLessThan(0.23);
  });
});
