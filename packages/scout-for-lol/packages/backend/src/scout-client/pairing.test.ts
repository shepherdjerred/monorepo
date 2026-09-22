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

const { createPairing } = await import("./pairing.ts");

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
