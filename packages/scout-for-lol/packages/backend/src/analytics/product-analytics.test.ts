import {
  createProductAnalytics,
  type ProductAnalyticsTransport,
} from "#src/analytics/product-analytics.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { describe, expect, test, vi } from "vitest";

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
        serverId: DiscordGuildIdSchema.parse("1310000000000000001"),
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
        serverId: DiscordGuildIdSchema.parse("1310000000000000001"),
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

  test("scopes a desktop event to a one-way owner digest with bounded properties", () => {
    const transport = createTransportFixture();
    const analytics = createProductAnalytics({
      analyticsConfiguration,
      environment: "beta",
      version: "2.0.0-9000",
      transport,
    });
    const ownerId = "1310000000000000042";

    analytics.captureDesktop(
      { ownerId },
      {
        event: "window_crashed",
        appVersion: "0.1.0",
        properties: {
          platform: "windows",
          cause: "exited",
          outcome: "relaunched",
        },
      },
    );

    expect(transport.capture).toHaveBeenCalledTimes(1);
    const message = transport.capture.mock.calls[0]?.[0];
    expect(message?.event).toBe("desktop_window_crashed");
    expect(message?.disableGeoip).toBe(true);
    expect(message?.distinctId).toMatch(
      /^scout-beta:desktop-owner:[0-9a-f]{32}$/,
    );
    expect(JSON.stringify(message)).not.toContain(ownerId);
    expect(message?.properties).toEqual({
      platform: "windows",
      cause: "exited",
      outcome: "relaunched",
      app_version: "0.1.0",
      stage: "beta",
      site_key: "scout-beta",
      site_hostname: "beta.scout-for-lol.com",
      source: "scout-desktop",
      version: "2.0.0-9000",
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
          serverId: DiscordGuildIdSchema.parse("1310000000000000001"),
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
