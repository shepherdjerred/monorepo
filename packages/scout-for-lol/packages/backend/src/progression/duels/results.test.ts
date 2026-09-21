import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    duelGame: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));

const { duelMatchNeedsTimeline } = await import("./results.ts");
const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
});

test("roster fallback considers only locally observed duel lobbies", async () => {
  await expect(duelMatchNeedsTimeline(fixture)).resolves.toBe(false);

  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ observedLobbyId: { not: null } }),
    }),
  );
});
