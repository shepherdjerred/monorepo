import { beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { ScopedScoutClient } from "./access/authentication.ts";
import { secretDigest } from "./secrets.ts";

const mocks = vi.hoisted(() => ({
  deviceFindUniqueOrThrow: vi.fn(),
  deviceFindFirst: vi.fn(),
  deviceUpdate: vi.fn(),
  deviceCreate: vi.fn(),
  pairingCreate: vi.fn(),
  pairingFindUnique: vi.fn(),
  pairingUpdateMany: vi.fn(),
  pairingDeleteMany: vi.fn(),
}));

const prismaMock = vi.hoisted(() => {
  const client = {
    scoutClientDevice: {
      findUniqueOrThrow: mocks.deviceFindUniqueOrThrow,
      findFirst: mocks.deviceFindFirst,
      update: mocks.deviceUpdate,
      create: mocks.deviceCreate,
    },
    scoutClientPairing: {
      create: mocks.pairingCreate,
      findUnique: mocks.pairingFindUnique,
      updateMany: mocks.pairingUpdateMany,
      deleteMany: mocks.pairingDeleteMany,
    },
    $transaction: async (run: (transaction: unknown) => unknown) =>
      await run(client),
  };
  return client;
});

vi.mock("#src/database/index.ts", () => ({ prisma: prismaMock }));
vi.mock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));

const { approvePairing, createScopeUpgrade, exchangePairing } =
  await import("./pairing.ts");

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const STRANGER = DiscordAccountIdSchema.parse("260509172704739329");
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const REQUEST_ID = "9c1d5b0e-6f0a-4c43-8d57-2a7b1e3f4a90";
const NOW = new Date("2026-11-14T12:00:00.000Z");

function pairedDevice(scopes: ScopedScoutClient["scopes"]): ScopedScoutClient {
  return { deviceId: DEVICE_ID, ownerId: OWNER, appVersion: "0.4.0", scopes };
}

function upgradeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    deviceName: "Scout Desktop",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "0.4.0",
    scopes: ["explore"],
    state: "PENDING",
    expiresAt: new Date(NOW.getTime() + 5 * 60_000),
    approvedById: null,
    upgradeDeviceId: DEVICE_ID,
    upgradeFor: { ownerId: OWNER, deviceState: "ACTIVE" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deviceFindUniqueOrThrow.mockResolvedValue({
    deviceName: "Scout Desktop",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "0.4.0",
    protocolVersion: 1,
  });
  mocks.pairingCreate.mockResolvedValue({ id: REQUEST_ID });
  mocks.pairingUpdateMany.mockResolvedValue({ count: 1 });
  mocks.deviceFindFirst.mockResolvedValue({ scopes: ["ingest"] });
  mocks.deviceUpdate.mockResolvedValue({});
});

describe("requesting a scope upgrade", () => {
  test("records a pending request for the same device and changes nothing on it", async () => {
    const result = await createScopeUpgrade(
      pairedDevice(["ingest"]),
      ["explore"],
      NOW,
    );

    expect(result).toMatchObject({
      status: "created",
      requestId: REQUEST_ID,
      scopes: ["explore"],
      approvalUrl: `https://scout.invalid/app/scout-client/pair/${REQUEST_ID}`,
      expiresAt: "2026-11-14T12:10:00.000Z",
    });
    expect(mocks.pairingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          upgradeDeviceId: DEVICE_ID,
          scopes: ["explore"],
          deviceName: "Scout Desktop",
        }),
      }),
    );
    // The device is read, never written: asking cannot grant anything.
    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
  });

  test("replaces the device's earlier open request", async () => {
    await createScopeUpgrade(pairedDevice(["ingest"]), ["explore"], NOW);

    expect(mocks.pairingUpdateMany).toHaveBeenCalledWith({
      where: { upgradeDeviceId: DEVICE_ID, state: "PENDING" },
      data: { state: "EXPIRED" },
    });
  });

  test("refuses to request scopes the device already holds", async () => {
    const result = await createScopeUpgrade(
      pairedDevice(["ingest", "explore"]),
      ["explore"],
      NOW,
    );

    expect(result).toEqual({ status: "already-granted" });
    expect(mocks.pairingCreate).not.toHaveBeenCalled();
  });

  test("is never exchanged for a credential, even with a matching secret", async () => {
    mocks.pairingFindUnique.mockResolvedValue({
      ...upgradeRow({ state: "APPROVED", approvedById: OWNER }),
      secretDigest: secretDigest("scp_known"),
      protocolVersion: 1,
    });

    expect(await exchangePairing(REQUEST_ID, "scp_known", NOW)).toBeNull();
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
  });
});

describe("approving a scope upgrade", () => {
  test("adds the scope to the same device and never creates another", async () => {
    mocks.pairingFindUnique.mockResolvedValue(upgradeRow());

    expect(await approvePairing(REQUEST_ID, OWNER, NOW)).toBe("approved");

    expect(mocks.deviceUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: DEVICE_ID },
      data: { scopes: { set: ["ingest", "explore"] } },
    });
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
    // The token digest and device id are never part of the update.
    expect(JSON.stringify(mocks.deviceUpdate.mock.calls)).not.toContain(
      "tokenDigest",
    );
  });

  test("only the device's owner can approve it", async () => {
    mocks.pairingFindUnique.mockResolvedValue(upgradeRow());

    expect(await approvePairing(REQUEST_ID, STRANGER, NOW)).toBe("not-owner");

    expect(mocks.pairingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
  });

  test("an owner whose device was revoked in the meantime gets nothing", async () => {
    mocks.pairingFindUnique.mockResolvedValue(upgradeRow());
    mocks.deviceFindFirst.mockResolvedValue(null);

    expect(await approvePairing(REQUEST_ID, OWNER, NOW)).toBe("not-owner");

    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
  });

  test("an expired request is refused and leaves the device alone", async () => {
    mocks.pairingFindUnique.mockResolvedValue(
      upgradeRow({ expiresAt: new Date(NOW.getTime() - 1) }),
    );

    expect(await approvePairing(REQUEST_ID, OWNER, NOW)).toBe("expired");

    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
  });

  test("a request claimed by a concurrent approval is refused", async () => {
    mocks.pairingFindUnique.mockResolvedValue(upgradeRow());
    mocks.pairingUpdateMany.mockResolvedValue({ count: 0 });

    expect(await approvePairing(REQUEST_ID, OWNER, NOW)).toBe("expired");

    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
  });

  test("approving twice does not add the scope twice", async () => {
    mocks.pairingFindUnique.mockResolvedValue(upgradeRow());
    mocks.deviceFindFirst.mockResolvedValue({ scopes: ["ingest", "explore"] });

    await approvePairing(REQUEST_ID, OWNER, NOW);

    expect(mocks.deviceUpdate).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: { scopes: { set: ["ingest", "explore"] } },
    });
  });
});
