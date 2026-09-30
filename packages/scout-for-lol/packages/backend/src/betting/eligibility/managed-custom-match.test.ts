import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  findLobby: vi.fn(),
  findCustomGame: vi.fn(),
  findDuelGame: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    tournamentLobby: { findUnique: mocks.findLobby },
    customGame: { findUnique: mocks.findCustomGame },
    duelGame: { findUnique: mocks.findDuelGame },
  },
}));

const { isScoutManagedCustomMatch } = await import("./managed-custom-match.ts");
const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findLobby.mockResolvedValue(null);
  mocks.findCustomGame.mockResolvedValue(null);
  mocks.findDuelGame.mockResolvedValue(null);
});

test("unbound same-roster games cannot qualify custom earnings", async () => {
  await expect(isScoutManagedCustomMatch(fixture)).resolves.toBe(false);

  expect(mocks.findCustomGame).toHaveBeenCalledWith({
    where: { matchId: fixture.metadata.matchId },
    select: { id: true },
  });
  expect(mocks.findDuelGame).toHaveBeenCalledWith({
    where: { matchId: fixture.metadata.matchId },
    select: { id: true },
  });
});

test("an exact scheduled match identity qualifies custom earnings", async () => {
  mocks.findCustomGame.mockResolvedValue({ id: "custom-game" });

  await expect(isScoutManagedCustomMatch(fixture)).resolves.toBe(true);
});
