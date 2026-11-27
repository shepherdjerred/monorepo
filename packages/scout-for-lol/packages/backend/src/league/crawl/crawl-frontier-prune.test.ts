import { describe, expect, test } from "vitest";
import {
  CRAWL_FRONTIER_BACKLOG_DAYS,
  CRAWL_FRONTIER_MIN_BACKLOG,
  CRAWL_FRONTIER_STALE_DAYS,
  crawlFrontierBacklogCap,
} from "./crawl-frontier-prune.ts";
import { CRAWL_LOOKBACK_DAYS } from "./crawl-config.ts";

describe("frontier retention rules", () => {
  test("a row unclaimed for the whole lookback is stale", () => {
    expect(CRAWL_FRONTIER_STALE_DAYS).toBe(CRAWL_LOOKBACK_DAYS);
  });

  test("the backlog a depth keeps scales with the daily match budget, with a floor", () => {
    expect(crawlFrontierBacklogCap(1000)).toBe(CRAWL_FRONTIER_MIN_BACKLOG);
    expect(crawlFrontierBacklogCap(20_000)).toBe(
      20_000 * CRAWL_FRONTIER_BACKLOG_DAYS,
    );
    expect(crawlFrontierBacklogCap(485_000)).toBe(
      485_000 * CRAWL_FRONTIER_BACKLOG_DAYS,
    );
  });
});
