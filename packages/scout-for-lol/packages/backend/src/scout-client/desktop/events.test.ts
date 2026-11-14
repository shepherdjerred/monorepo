import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AuthenticatedScoutClient } from "#src/scout-client/authentication.ts";
import { createAnalyticsFixture } from "#src/testing/analytics-fixture.ts";

type AnalyticsFixture = ReturnType<typeof createAnalyticsFixture>;

const authenticate = vi.hoisted(() =>
  vi.fn<() => Promise<AuthenticatedScoutClient | null>>(),
);
const analytics: { current: AnalyticsFixture | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("#src/scout-client/authentication.ts", () => ({
  authenticateScoutClient: authenticate,
}));
vi.mock("#src/analytics/product-analytics.ts", () => ({
  getProductAnalytics: () => analytics.current?.analytics,
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { desktopEventAllowed, resetDesktopEventLimitForTests } =
  await import("./events.ts");

const device: AuthenticatedScoutClient = {
  deviceId: "3f2b6f6e-7a54-4f55-9a2c-3f2d6a1d9a10",
  ownerId: DiscordAccountIdSchema.parse("1310000000000000042"),
  appVersion: "0.1.0",
};
const validEvent = {
  event: "app_started",
  appVersion: "0.1.0",
  properties: { platform: "windows" },
};

async function post(body: unknown): Promise<Response> {
  const request = new Request(
    "https://scout.invalid/api/scout-client/v1/desktop/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sct_test",
      },
      body: JSON.stringify(body),
    },
  );
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

describe("desktop events route", () => {
  beforeEach(() => {
    analytics.current = createAnalyticsFixture();
    authenticate.mockReset();
    authenticate.mockResolvedValue(device);
    resetDesktopEventLimitForTests();
  });

  test("requires an authenticated device", async () => {
    authenticate.mockResolvedValue(null);
    const response = await post(validEvent);
    expect(response.status).toBe(401);
    expect(analytics.current?.captureDesktop).not.toHaveBeenCalled();
  });

  test("forwards a valid event under the device owner's identity", async () => {
    const response = await post(validEvent);
    expect(response.status).toBe(202);
    expect(analytics.current?.captureDesktop).toHaveBeenCalledExactlyOnceWith(
      { ownerId: device.ownerId },
      validEvent,
    );
  });

  test.each([
    ["an unknown event", { ...validEvent, event: "champion_picked" }],
    [
      "an unknown property",
      { ...validEvent, properties: { platform: "windows", puuid: "x" } },
    ],
    ["an unknown field", { ...validEvent, riotId: "Name#TAG1" }],
    [
      "a free-text value",
      {
        ...validEvent,
        properties: { platform: String.raw`C:\Users\x` },
      },
    ],
  ])("rejects %s without forwarding", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(analytics.current?.captureDesktop).not.toHaveBeenCalled();
  });

  test("rate-limits each device independently", async () => {
    for (let call = 0; call < 30; call += 1) {
      const accepted = await post(validEvent);
      expect(accepted.status).toBe(202);
    }
    const limited = await post(validEvent);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(analytics.current?.captureDesktop).toHaveBeenCalledTimes(30);

    authenticate.mockResolvedValue({
      ...device,
      deviceId: "0d5a1c52-86b0-4c1e-8f0f-6c0b1e3a7d11",
    });
    const otherDevice = await post(validEvent);
    expect(otherDevice.status).toBe(202);
  });

  test("the limiter window resets after a minute", () => {
    const start = Date.parse("2026-11-13T12:00:00.000Z");
    resetDesktopEventLimitForTests(start);
    for (let call = 0; call < 30; call += 1) {
      expect(desktopEventAllowed(device.deviceId, start)).toBe(true);
    }
    expect(desktopEventAllowed(device.deviceId, start)).toBe(false);
    expect(desktopEventAllowed(device.deviceId, start + 60_000)).toBe(true);
  });
});
