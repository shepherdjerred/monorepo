import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    duelGame: {
      findFirst: mocks.findFirst,
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
});

test("does not identify a duel from a repeated roster", async () => {
  await expect(duelMatchNeedsTimeline(fixture)).resolves.toBe(false);

  expect(mocks.findFirst).toHaveBeenCalledTimes(1);
});

test("retains tournament-code lookup for in-flight legacy duels", async () => {
  const tournamentMatch = RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, tournamentCode: "LEGACY-DUEL-CODE" },
  });

  await expect(duelMatchNeedsTimeline(tournamentMatch)).resolves.toBe(false);

  expect(mocks.findFirst).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: expect.objectContaining({
        tournamentLobby: { is: { code: "LEGACY-DUEL-CODE" } },
      }),
    }),
  );
});
