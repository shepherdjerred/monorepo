import { describe, expect, test, vi } from "vitest";
import {
  createProductAnalytics,
  type ProductAnalyticsTransport,
} from "#src/analytics/product-analytics.ts";

const analyticsConfiguration = {
  projectToken: "phc_test",
  apiHost: "https://us.i.posthog.com",
  siteKey: "scout-beta",
  siteHostname: "beta.scout-for-lol.com",
};

function createTransportFixture() {
  const capture = vi.fn<ProductAnalyticsTransport["capture"]>(() => null);
  const shutdown = vi.fn<ProductAnalyticsTransport["shutdown"]>(() =>
    Promise.resolve(),
  );
  return { capture, shutdown };
}

describe("Scout product analytics adapter", () => {
  test("is a no-op when analytics configuration is disabled", async () => {
    const transport = createTransportFixture();
    const analytics = createProductAnalytics({
      analyticsConfiguration: undefined,
      environment: "dev",
      version: "test-version",
      transport,
    });

    analytics.capture(
      {
        analyticsInstallationId: "7316395a-b815-49d8-9794-9b56b3ce81c0",
        analyticsLifecycleTracked: true,
        serverId: "1310000000000000001",
      },
      {
        event: "guild_installed",
        properties: {
          install_kind: "first",
          member_count_bucket: "11-50",
        },
      },
    );
    await analytics.shutdown();

    expect(transport.capture).not.toHaveBeenCalled();
    expect(transport.shutdown).not.toHaveBeenCalled();
  });

  test("sends only the closed event properties plus anonymous common properties", () => {
    const transport = createTransportFixture();
    const analytics = createProductAnalytics({
      analyticsConfiguration,
      environment: "beta",
      version: "2.0.0-9000",
      transport,
    });

    analytics.capture(
      {
        analyticsInstallationId: "7316395a-b815-49d8-9794-9b56b3ce81c0",
        analyticsLifecycleTracked: true,
        serverId: "1310000000000000001",
      },
      {
        event: "core_output_delivered",
        properties: { output_kind: "postmatch" },
      },
    );

    expect(transport.capture).toHaveBeenCalledWith({
      distinctId:
        "scout-beta:guild-install:7316395a-b815-49d8-9794-9b56b3ce81c0",
      event: "core_output_delivered",
      disableGeoip: true,
      properties: {
        output_kind: "postmatch",
        guild_id: "1310000000000000001",
        stage: "beta",
        site_key: "scout-beta",
        site_hostname: "beta.scout-for-lol.com",
        source: "scout-backend",
        version: "2.0.0-9000",
        lifecycle_cohort: "tracked",
      },
    });
  });

  test("flushes the transport during shutdown", async () => {
    const transport = createTransportFixture();
    const analytics = createProductAnalytics({
      analyticsConfiguration,
      environment: "prod",
      version: "test-version",
      transport,
    });

    await analytics.shutdown();

    expect(transport.shutdown).toHaveBeenCalledTimes(1);
  });

  test("keeps synchronous capture and shutdown failures non-fatal", async () => {
    const capture = vi.fn<ProductAnalyticsTransport["capture"]>(() => {
      throw new Error("capture failed");
    });
    const shutdown = vi.fn<ProductAnalyticsTransport["shutdown"]>(() =>
      Promise.reject(new Error("shutdown failed")),
    );
    const analytics = createProductAnalytics({
      analyticsConfiguration,
      environment: "prod",
      version: "test-version",
      transport: { capture, shutdown },
    });

    expect(() =>
      analytics.capture(
        {
          analyticsInstallationId: "7316395a-b815-49d8-9794-9b56b3ce81c0",
          analyticsLifecycleTracked: false,
          serverId: "1310000000000000001",
        },
        {
          event: "first_subscription_created",
          properties: { surface: "web" },
        },
      ),
    ).not.toThrow();
    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });
});
