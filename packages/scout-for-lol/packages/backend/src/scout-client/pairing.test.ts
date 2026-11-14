import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientPairing: {
      create: mocks.create,
      deleteMany: mocks.deleteMany,
    },
  },
}));

vi.mock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));

const { createPairing, pairingMatchCode } = await import("./pairing.ts");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.create.mockResolvedValue({
    id: "4fa2a856-53af-42a4-85af-5cc085a942a3",
  });
});

test("prunes old abandoned pairings before creating another", async () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  await createPairing(
    {
      deviceName: "Test client",
      platform: "windows",
      architecture: "x86_64",
      appVersion: "0.1.0",
      protocolVersion: 1,
    },
    now,
  );

  expect(mocks.deleteMany).toHaveBeenCalledWith({
    where: {
      state: { in: ["PENDING", "APPROVED", "EXPIRED"] },
      expiresAt: { lt: new Date("2026-09-19T12:00:00.000Z") },
    },
  });
  expect(mocks.create).toHaveBeenCalledOnce();
});

test("a pairing asks for ingest only unless the caller names more scopes", async () => {
  const input = {
    deviceName: "Test client",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "0.1.0",
    protocolVersion: 1,
  } as const;

  const ingest = await createPairing(input);
  const desktop = await createPairing(input, new Date(), ["ingest", "explore"]);

  expect(ingest.scopes).toEqual(["ingest"]);
  expect(desktop.scopes).toEqual(["ingest", "explore"]);
  expect(mocks.create).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      data: expect.objectContaining({ scopes: ["ingest"] }),
    }),
  );
  expect(mocks.create).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      data: expect.objectContaining({ scopes: ["ingest", "explore"] }),
    }),
  );
});

test("the match code is stable, short and free of look-alike characters", () => {
  const id = "4fa2a856-53af-42a4-85af-5cc085a942a3";

  expect(pairingMatchCode(id)).toBe(pairingMatchCode(id));
  expect(pairingMatchCode(id)).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  expect(pairingMatchCode(id)).not.toBe(
    pairingMatchCode("0f4d6c1e-8a51-4c62-9a1e-3b7f2d9c5e10"),
  );
});
