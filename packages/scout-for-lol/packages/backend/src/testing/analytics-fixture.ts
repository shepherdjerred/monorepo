import { vi } from "vitest";
import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";

export function createAnalyticsFixture() {
  const capture = vi.fn<ProductAnalytics["capture"]>();
  const captureBucksMember = vi.fn<ProductAnalytics["captureBucksMember"]>();
  const captureBucksSystem = vi.fn<ProductAnalytics["captureBucksSystem"]>();
  const shutdown = vi.fn<ProductAnalytics["shutdown"]>(() => Promise.resolve());
  return {
    analytics: { capture, captureBucksMember, captureBucksSystem, shutdown },
    capture,
    shutdown,
  };
}
