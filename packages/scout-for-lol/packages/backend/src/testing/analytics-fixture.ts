import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";
import { vi } from "vitest";

export function createAnalyticsFixture() {
  const capture = vi.fn<ProductAnalytics["capture"]>();
  const captureDesktop = vi.fn<ProductAnalytics["captureDesktop"]>();
  const shutdown = vi.fn<ProductAnalytics["shutdown"]>(() => Promise.resolve());
  return {
    analytics: { capture, captureDesktop, shutdown },
    capture,
    captureDesktop,
    shutdown,
  };
}
