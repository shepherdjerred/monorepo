import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopScopeRequestResponseSchema,
} from "@scout-for-lol/data";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-client-scope-upgrade");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));
vi.doMock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { approvePairing, createPairing, exchangePairing } =
  await import("#src/scout-client/pairing.ts");
const { resetDesktopReadRateLimitForTests } = await import("./rate-limit.ts");

const OWNER_ID = DiscordAccountIdSchema.parse("160509172704739328");
const OTHER_USER_ID = DiscordAccountIdSchema.parse("160509172704739329");
const ORIGIN = "https://scout.invalid";
const REQUEST_PATH = SCOUT_DESKTOP_API_ROUTES.device_scope_requests.path;

/** An `ingest`-only device, as every device paired before chat is. */
async function pairedIngestDevice() {
  const pairing = await createPairing({
    deviceName: "Scout Desktop",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "0.4.0",
    protocolVersion: 1,
  });
  expect(await approvePairing(pairing.pairingId, OWNER_ID)).toBe("approved");
  const exchange = await exchangePairing(
    pairing.pairingId,
    pairing.pairingSecret,
  );
  if (exchange?.status !== "approved") throw new Error("pairing failed");
  return { deviceId: exchange.deviceId, token: exchange.token };
}

async function requestUpgrade(token: string) {
  const request = new Request(`${ORIGIN}${REQUEST_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "3",
    },
    body: JSON.stringify({ scopes: ["explore"] }),
  });
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function upgradeBody(token: string): Promise<unknown> {
  const response = await requestUpgrade(token);
  return await response.json();
}

beforeEach(async () => {
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  // Devices first: they cascade from their owner and reference their pairing.
  await prisma.$transaction([
    prisma.scoutClientDeviceVersion.deleteMany(),
    prisma.scoutClientDevice.deleteMany(),
    prisma.scoutClientPairing.deleteMany(),
    prisma.user.deleteMany(),
    prisma.user.createMany({
      data: [OWNER_ID, OTHER_USER_ID].map((discordId) => ({
        discordId,
        discordUsername: `user-${discordId}`,
      })),
    }),
  ]);
});

describe("scope upgrade against the database", () => {
  test("approving adds explore to the same device and keeps its token", async () => {
    const device = await pairedIngestDevice();
    const response = await requestUpgrade(device.token);
    expect(response.status).toBe(201);
    const upgrade = ScoutDesktopScopeRequestResponseSchema.parse(
      await response.json(),
    );

    expect(await approvePairing(upgrade.requestId, OWNER_ID)).toBe("approved");

    const devices = await prisma.scoutClientDevice.findMany();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.id).toBe(device.deviceId);
    expect(devices[0]?.scopes).toEqual(["ingest", "explore"]);
    // The unchanged token still authenticates the device.
    const again = await requestUpgrade(device.token);
    expect(ScoutDesktopApiErrorSchema.parse(await again.json()).error).toBe(
      "scope_already_granted",
    );
  });

  test("another account cannot approve it", async () => {
    const device = await pairedIngestDevice();
    const upgrade = ScoutDesktopScopeRequestResponseSchema.parse(
      await upgradeBody(device.token),
    );

    expect(await approvePairing(upgrade.requestId, OTHER_USER_ID)).toBe(
      "not-owner",
    );

    const stored = await prisma.scoutClientDevice.findUniqueOrThrow({
      where: { id: device.deviceId },
    });
    expect(stored.scopes).toEqual(["ingest"]);
  });

  test("an expired request is refused and the device is unchanged", async () => {
    const device = await pairedIngestDevice();
    const upgrade = ScoutDesktopScopeRequestResponseSchema.parse(
      await upgradeBody(device.token),
    );
    const afterExpiry = new Date(Date.parse(upgrade.expiresAt) + 1000);

    expect(await approvePairing(upgrade.requestId, OWNER_ID, afterExpiry)).toBe(
      "expired",
    );

    const stored = await prisma.scoutClientDevice.findUniqueOrThrow({
      where: { id: device.deviceId },
    });
    expect(stored.scopes).toEqual(["ingest"]);
  });

  test("a newer request replaces the earlier link", async () => {
    const device = await pairedIngestDevice();
    const first = ScoutDesktopScopeRequestResponseSchema.parse(
      await upgradeBody(device.token),
    );
    await requestUpgrade(device.token);

    expect(await approvePairing(first.requestId, OWNER_ID)).toBe("expired");
  });
});
