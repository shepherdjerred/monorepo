import { describe, it, expect } from "bun:test";
import type { RawMatch, Player } from "@scout-for-lol/data";
import {
  ArenaMatchSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { toArenaMatch } from "@scout-for-lol/backend/league/model/match.ts";

const currentDir = new URL(".", import.meta.url).pathname;

const RAW_FILE_PATHS = [
  `${currentDir}/testdata/matches_2025_09_19_NA1_5370969615.json`,
  `${currentDir}/testdata/matches_2025_09_19_NA1_5370986469.json`,
];

async function loadMatch(path: string): Promise<RawMatch> {
  const file = Bun.file(path);
  const json = (await file.json()) as unknown;
  return RawMatchSchema.parse(json);
}

describe("toArenaMatch with real arena JSON", () => {
  it("produces valid ArenaMatch for each provided real match JSON", async () => {
    for (const path of RAW_FILE_PATHS) {
      const rawMatch = await loadMatch(path);
      expect(rawMatch.info.queueId).toBe(1700);
      expect(rawMatch.info.gameMode).toBe("CHERRY");
      expect(rawMatch.info.mapId).toBe(30);
      expect(rawMatch.info.participants.length).toBe(16);
      // choose first participant as the tracked player
      const tracked = rawMatch.info.participants[0];
      if (!tracked) {
        throw new Error("participants should not be empty in real data test");
      }

      const player = {
        config: {
          alias: "RealDataUser",
          league: {
            leagueAccount: {
              puuid: LeaguePuuidSchema.parse(tracked.puuid),
              region: "PBE",
            },
          },
          discordAccount: undefined,
        },
        ranks: {},
      } satisfies Player;

      const arenaMatch = await toArenaMatch([player], rawMatch);
      const parsed = ArenaMatchSchema.parse(arenaMatch);

      expect(parsed).toMatchSnapshot();
    }
  });
});
