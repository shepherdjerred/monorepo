import { describe, expect, test } from "vitest";
import { simulateCrawlTarget } from "#src/testing/riot-rate-simulation.ts";

/**
 * The crawl target on the production key's windows (500/10s, 30,000/600s)
 * with a fixed tracked baseline: realtime at 10% of the key, plus a little
 * backfill and interactive from a second pod that cannot see the crawl's
 * share. The crawl has infinite demand.
 */

const MINUTES = 20;

describe("crawl utilisation target simulation", () => {
  test.each([0.25, 0.5, 0.85])(
    "at %s the crawl fills the target, never past it, and tracked traffic keeps its rate",
    (target) => {
      const summary = simulateCrawlTarget({ target, minutes: MINUTES });

      expect(summary.rejected).toBe(0);
      for (const [window, limit] of [
        ["10", 500],
        ["600", 30_000],
      ] as const) {
        const counts = summary.perWindow[window];
        // Total use stays at or under the target...
        expect(summary.peakUtilisation[window]).toBeLessThanOrEqual(target);
        // ...and comes close to it: the crawl takes what tracked leaves.
        expect(counts.total / limit).toBeGreaterThan(target - 0.02);
        // Tracked traffic is served at its full offered rate.
        expect(counts.realtime).toBe(window === "10" ? 50 : 3000);
        expect(counts.interactive).toBe(window === "10" ? 10 : 600);
        expect(counts.backfill).toBe(window === "10" ? 5 : 300);
      }
      // Realtime waits only for its own first probe after the restart.
      expect(summary.realtimeDeferred).toBe(summary.startupRealtimeDeferred);
      expect(summary.realtimeMaxWaitMs).toBeLessThanOrEqual(100);
    },
  );

  test("after a restart the crawl causes no realtime deferral and sends one probe, not a burst", () => {
    const baseline = simulateCrawlTarget({
      target: 0.85,
      minutes: 2,
      crawlOff: true,
    });
    for (const target of [0.25, 0.85]) {
      const summary = simulateCrawlTarget({ target, minutes: 2 });
      // The same deferrals as with no crawl at all: realtime's own slow start.
      expect(summary.startupRealtimeDeferred).toBe(
        baseline.startupRealtimeDeferred,
      );
      expect(summary.realtimeMaxWaitMs).toBe(baseline.realtimeMaxWaitMs);
      // First to answer: one realtime probe and at most one crawl probe.
      expect(summary.firstResponders).toEqual(["crawl", "realtime"]);
    }
  });

  test("without realtime, the observed ratio stays under 0.92 even with two pods racing", () => {
    // Crawl, backfill and interactive all saturate in both pods. Each pod admits
    // against counts that lag the other's in-flight requests, so the short
    // window can pass the 0.90 non-realtime cap by a few requests; it never
    // reaches 0.92, which is what the critical alert's threshold relies on.
    for (const target of [0.25, 0.85, 1]) {
      const summary = simulateCrawlTarget({
        target,
        minutes: MINUTES,
        trackedOnly: true,
      });
      expect(summary.rejected).toBe(0);
      expect(summary.peakUtilisation["10"]).toBeLessThan(0.92);
      expect(summary.peakUtilisation["600"]).toBeLessThan(0.92);
      expect(summary.peakUtilisation["600"]).toBeGreaterThanOrEqual(0.9);
    }
  });
});
