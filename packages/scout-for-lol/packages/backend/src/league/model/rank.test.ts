import { describe, expect, test, vi } from "vitest";
import { PlayerConfigEntrySchema } from "@scout-for-lol/data/index.ts";

const byPuuid = vi.fn<() => Promise<unknown>>();

vi.doMock("#src/league/api/api.ts", () => ({
  riotClient: {
    league: {
      byPuuid,
    },
  },
}));

const { getRanks } = await import("./rank.ts");

describe("getRanks", () => {
  test("returns empty ranks when the Riot rank lookup fails", async () => {
    byPuuid.mockRejectedValueOnce(
      new Error("API request timed out after 30000ms"),
    );

    const player = PlayerConfigEntrySchema.parse({
      alias: "Brandon",
      league: {
        leagueAccount: {
          puuid: "a".repeat(78),
          region: "AMERICA_NORTH",
        },
      },
    });

    const ranks = await getRanks(player);

    expect(byPuuid).toHaveBeenCalledOnce();
    expect(ranks).toEqual({
      solo: undefined,
      flex: undefined,
    });
  });
});
