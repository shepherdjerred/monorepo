import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";
import { vi } from "vitest";

export function createAnalyticsFixture() {
  const capture = vi.fn<ProductAnalytics["capture"]>();
  const shutdown = vi.fn<ProductAnalytics["shutdown"]>(() => Promise.resolve());
  return {
    analytics: { capture, shutdown },
    capture,
    shutdown,
  };
}
