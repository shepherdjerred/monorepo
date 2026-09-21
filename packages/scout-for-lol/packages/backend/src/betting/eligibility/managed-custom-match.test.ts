import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  findLobby: vi.fn(),
  findCustomGames: vi.fn(),
  findDuelGames: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    tournamentLobby: { findUnique: mocks.findLobby },
    customGame: { findMany: mocks.findCustomGames },
    duelGame: { findMany: mocks.findDuelGames },
  },
}));

const { isScoutManagedCustomMatch } = await import("./managed-custom-match.ts");
const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findLobby.mockResolvedValue(null);
  mocks.findCustomGames.mockResolvedValue([]);
  mocks.findDuelGames.mockResolvedValue([]);
});

test("unbound same-roster games cannot qualify custom earnings", async () => {
  await expect(isScoutManagedCustomMatch(fixture)).resolves.toBe(false);

  expect(mocks.findCustomGames).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: expect.arrayContaining([
          expect.objectContaining({ observedLobbyId: { not: null } }),
        ]),
      },
    }),
  );
  expect(mocks.findDuelGames).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: expect.arrayContaining([
          expect.objectContaining({ observedLobbyId: { not: null } }),
        ]),
      },
    }),
  );
});
