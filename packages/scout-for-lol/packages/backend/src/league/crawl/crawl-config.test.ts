import { describe, expect, test } from "vitest";
import {
  CRAWL_COOLDOWN_DAYS,
  CRAWL_MAX_DEPTH,
  CRAWL_TIMELINE_PERCENT,
  crawlCooldownEnd,
  crawlHardDisabledIn,
  crawlLookbackStart,
  crawlMatchesPerTick,
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

  test("pace a tick from the daily budget", () => {
    expect(crawlMatchesPerTick(1000)).toBe(5);
    expect(crawlMatchesPerTick(5500)).toBe(16);
    expect(crawlMatchesPerTick(55_000)).toBe(156);
  });

  test("hard-disable production only", () => {
    expect(crawlHardDisabledIn("prod")).toBe(true);
    expect(crawlHardDisabledIn("beta")).toBe(false);
    expect(crawlHardDisabledIn("dev")).toBe(false);
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
