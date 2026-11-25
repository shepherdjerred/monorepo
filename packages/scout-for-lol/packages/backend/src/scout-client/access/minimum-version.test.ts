import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCOUT_CLIENT_UPGRADE_REQUIRED_STATUS,
  ScoutClientUpgradeRequiredSchema,
} from "@scout-for-lol/data";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  initializeDynamicConfig,
  shutdownDynamicConfig,
} from "#src/config/dynamic.ts";
import { DEFAULT_EXPLORE_QUOTA_LIMITS } from "#src/configuration/explore-quota.ts";

const mocks = vi.hoisted(() => ({
  device: { appVersion: "0.1.0" },
  findDevice: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientDevice: { findUnique: mocks.findDevice, update: vi.fn() },
    scoutClientDeviceVersion: { upsert: vi.fn() },
    scoutClientObservation: { aggregate: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
vi.mock("./policy.ts", () => ({
  isScoutClientLive: () => Promise.resolve(true),
  isScoutClientEnabledFor: () => Promise.resolve(true),
}));

const { clientUpgradeRequired } = await import("./minimum-version.ts");
const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");

async function startConfig(values: Record<string, string> = {}) {
  await initializeDynamicConfig({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider(values),
    seed: {
      exploreGuildAllowlist: [],
      exploreQuotaLimits: DEFAULT_EXPLORE_QUOTA_LIMITS,
      llmHourlyTokenBudget: 2_000_000,
      llmDailyTokenBudget: 20_000_000,
      temporalCallGraphTracing: false,
    },
    startPolling: false,
  });
}

function deviceRequest(path: string, body: unknown): Request {
  return new Request(`https://scout.invalid/api/scout-client/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer sct_${"t".repeat(40)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function send(request: Request) {
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("Route was not handled");
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findDevice.mockImplementation(() =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000001",
      ownerId: "160509172704739328",
      appVersion: mocks.device.appVersion,
      deviceState: "ACTIVE",
      scopes: ["ingest"],
    }),
  );
});
afterEach(async () => {
  await shutdownDynamicConfig();
  mocks.device.appVersion = "0.1.0";
});

describe("clientUpgradeRequired", () => {
  test.each(["0.1.0", "0.1.1", "0.2.0", "1.0.0", "0.1.0+build.7"])(
    "accepts %s at the default minimum",
    (appVersion) => {
      expect(clientUpgradeRequired(appVersion)).toBeNull();
    },
  );

  test.each(["0.0.9", "0.1.0-beta.1", "dev", "0.1", ""])(
    "refuses %s at the default minimum",
    (appVersion) => {
      expect(clientUpgradeRequired(appVersion)).toEqual({
        error: "client_upgrade_required",
        minimumVersion: "0.1.0",
      });
    },
  );

  test("follows a raised minimum from Flags", async () => {
    await startConfig({ "scout-client-minimum-version": "0.2.0" });
    expect(clientUpgradeRequired("0.2.0")).toBeNull();
    expect(clientUpgradeRequired("0.1.9")).toEqual({
      error: "client_upgrade_required",
      minimumVersion: "0.2.0",
    });
  });
});

describe("the device routes", () => {
  test("refuse a check-in below the minimum before recording the build", async () => {
    await startConfig({ "scout-client-minimum-version": "0.2.0" });
    const response = await send(
      deviceRequest("check-ins", { appVersion: "0.1.0", protocolVersion: 1 }),
    );
    expect(response.status).toBe(SCOUT_CLIENT_UPGRADE_REQUIRED_STATUS);
    expect(ScoutClientUpgradeRequiredSchema.parse(response.body)).toEqual({
      error: "client_upgrade_required",
      minimumVersion: "0.2.0",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  test("refuse a batch from a device whose checked-in build is below the minimum", async () => {
    await startConfig({ "scout-client-minimum-version": "0.2.0" });
    const response = await send(
      deviceRequest("observations/batch", { observations: [] }),
    );
    expect(response).toEqual({
      status: SCOUT_CLIENT_UPGRADE_REQUIRED_STATUS,
      body: { error: "client_upgrade_required", minimumVersion: "0.2.0" },
    });
  });

  test("accept a supported build's check-in", async () => {
    mocks.transaction.mockResolvedValue([{}, {}, { _max: { sequence: 4n } }]);
    const response = await send(
      deviceRequest("check-ins", { appVersion: "0.1.0", protocolVersion: 1 }),
    );
    expect(response).toEqual({
      status: 200,
      body: { accepted: true, nextSequence: 5 },
    });
  });
});
