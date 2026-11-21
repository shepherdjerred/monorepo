import { describe, expect, test } from "vitest";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { usageAnalyticsTransport } from "@shepherdjerred/streambot/observability/product-analytics.ts";

describe("usage analytics startup", () => {
  test("refuses an enabled flag with no PostHog destination", () => {
    const config = loadConfig({
      BOT_TOKEN: "fixture",
      USER_TOKENS: "fixture",
      VIDEOS_DIR: "/videos",
    });
    expect(config.analytics.enabled).toBe(true);
    expect(config.analytics.posthog).toBeUndefined();
    expect(() => usageAnalyticsTransport(config.analytics)).toThrow(
      "Usage analytics is enabled but POSTHOG_PROJECT_TOKEN and POSTHOG_API_HOST are not set",
    );
  });

  test("an explicit off starts without a PostHog destination", () => {
    const config = loadConfig({
      BOT_TOKEN: "fixture",
      USER_TOKENS: "fixture",
      VIDEOS_DIR: "/videos",
      USAGE_ANALYTICS_ENABLED: "false",
    });
    expect(config.analytics.enabled).toBe(false);
    expect(config.analytics.posthog).toBeUndefined();
    expect(() => usageAnalyticsTransport(config.analytics)).not.toThrow();
  });
});
