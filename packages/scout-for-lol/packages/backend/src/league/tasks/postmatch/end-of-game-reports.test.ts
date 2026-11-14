import { describe, expect, test } from "vitest";
import {
  type EndOfGameMatch,
  type Player,
  PlayerConfigEntrySchema,
} from "@scout-for-lol/data";
import {
  classicMatchToImage,
  classicMatchToSvg,
  matchToSvg,
  svgToPng,
} from "@scout-for-lol/report";
import { buildClassicMatch } from "./match-report-classic.ts";
import { toMatch } from "#src/league/model/match.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * A game Scout knows only from the League client's end-of-game block has no
 * timeline and no participant numbers. Its report is the scoreboard the block
 * states, rendered by the same builders as any other game.
 */
function trackedPlayerIn(match: EndOfGameMatch) {
  const participant = match.info.participants.find((p) => p.win);
  if (participant === undefined) throw new Error("The fixture has a winner");
  return PlayerConfigEntrySchema.parse({
    alias: "End Of Game",
    league: {
      leagueAccount: { puuid: participant.puuid, region: "AMERICA_NORTH" },
    },
  });
}

describe("reports from end-of-game data", () => {
  test("the Classic report builds and renders without a timeline", async () => {
    const match = await classicEndOfGameMatch();

    const classic = buildClassicMatch(match, [trackedPlayerIn(match)]);

    if (classic === undefined) throw new Error("The tracked player is in it");
    expect(classic.queueType).toBe("classic");
    expect(classic.mapName).toBe("Classic Rift");
    expect(classic.teams.blue).toHaveLength(5);
    expect(classic.teams.red).toHaveLength(5);
    expect(classic.players[0]?.outcome).toBe("Victory");
    const [svg, png] = await Promise.all([
      classicMatchToSvg(classic),
      classicMatchToImage(classic),
    ]);
    expect(svg).toContain("<svg");
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  test("the standard report builds and renders without a timeline", async () => {
    const classicRecord = await classicEndOfGameMatch();
    // The same block, as a ranked Summoner's Rift game the standard builder owns.
    const match: EndOfGameMatch = {
      ...classicRecord,
      info: {
        ...classicRecord.info,
        queueId: 420,
        gameMode: "CLASSIC",
        mapId: 11,
      },
    };
    const player: Player = { config: trackedPlayerIn(match), ranks: {} };

    const completed = toMatch([player], match, new Map());

    if (completed === undefined) throw new Error("The tracked player is in it");
    expect(completed.queueType).toBe("solo");
    expect(completed.players).toHaveLength(1);
    expect(completed.players[0]?.outcome).toBe("Victory");
    const svg = await matchToSvg(completed);
    const png = await svgToPng(svg);
    expect(svg).toContain("<svg");
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});
