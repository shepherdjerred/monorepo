import { describe, expect, mock, test } from "bun:test";
import { PlayerConfigEntrySchema } from "@scout-for-lol/data/index.ts";

const byPUUID = mock<() => Promise<{ response: unknown }>>();

void mock.module("#src/league/api/api.ts", () => ({
  api: {
    League: {
      byPUUID,
    },
  },
}));

const { getRanks } = await import("./rank.ts");

describe("getRanks", () => {
  test("returns empty ranks when the Riot rank lookup fails", async () => {
    byPUUID.mockRejectedValueOnce(
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

    expect(ranks).toEqual({
      solo: undefined,
      flex: undefined,
    });
  });
});
