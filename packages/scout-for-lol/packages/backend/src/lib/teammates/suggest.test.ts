import { describe, expect, test } from "vitest";
import {
  RawMatchSchema,
  type RawMatch,
  type Region,
} from "@scout-for-lol/data";
import { aggregateTeammates } from "#src/lib/teammates/suggest.ts";

const REGION: Region = "AMERICA_NORTH";
const SELF = "puuid-self";

const MATCH_PATH = `${import.meta.dir}/../../league/tasks/postmatch/testdata/match-clash-s3.json`;

async function baseMatch(): Promise<RawMatch> {
  const raw: unknown = JSON.parse(await Bun.file(MATCH_PATH).text());
  return RawMatchSchema.parse(raw);
}

type Row = {
  puuid: string;
  team: number;
  name?: string;
  tag?: string;
};

/** Re-roster a real parsed match: full participant rows are reused, only the
 * identity/team fields under test are overwritten. */
function roster(
  match: RawMatch,
  rows: Row[],
  opts?: { gameType?: string; end?: number },
): { match: RawMatch; region: Region } {
  const template = match.info.participants[0];
  if (template === undefined) throw new Error("fixture has no participants");
  const clone = structuredClone(match);
  clone.metadata.participants = rows.map((row) => row.puuid);
  clone.info.participants = rows.map((row) => {
    const participant = { ...template, puuid: row.puuid, teamId: row.team };
    if (row.name === undefined) {
      delete participant.riotIdGameName;
    } else {
      participant.riotIdGameName = row.name;
      participant.riotIdTagline = row.tag ?? "NA1";
    }
    return participant;
  });
  if (opts?.gameType !== undefined) clone.info.gameType = opts.gameType;
  if (opts?.end !== undefined) clone.info.gameEndTimestamp = opts.end;
  return { region: REGION, match: clone };
}

describe("aggregateTeammates", () => {
  test("counts same-team teammates and ignores opponents and self", async () => {
    const base = await baseMatch();
    const rounds = [
      roster(base, [
        { puuid: SELF, team: 100, name: "Me", tag: "NA1" },
        { puuid: "puuid-duo", team: 100, name: "Duo", tag: "NA1" },
        { puuid: "puuid-opp", team: 200, name: "Opp", tag: "NA1" },
      ]),
      roster(base, [
        { puuid: SELF, team: 100, name: "Me", tag: "NA1" },
        { puuid: "puuid-duo", team: 100, name: "Duo", tag: "NA1" },
        { puuid: "puuid-rando", team: 100, name: "Rando", tag: "NA1" },
      ]),
    ];

    const suggestions = aggregateTeammates({
      rounds,
      selfPuuids: new Set([SELF]),
      trackedPuuids: new Set([SELF]),
      topN: 5,
    });

    expect(suggestions.map((suggestion) => suggestion.riotId)).toEqual([
      "Duo#NA1",
      "Rando#NA1",
    ]);
    expect(suggestions[0]).toMatchObject({
      puuid: "puuid-duo",
      region: REGION,
      gamesTogether: 2,
    });
    expect(suggestions[1]).toMatchObject({ gamesTogether: 1 });
  });

  test("excludes already-tracked players and nameless rows", async () => {
    const base = await baseMatch();
    const rounds = [
      roster(base, [
        { puuid: SELF, team: 100, name: "Me" },
        { puuid: "puuid-tracked", team: 100, name: "Tracked" },
        { puuid: "puuid-bot", team: 100 },
      ]),
    ];

    const suggestions = aggregateTeammates({
      rounds,
      selfPuuids: new Set([SELF]),
      trackedPuuids: new Set([SELF, "puuid-tracked"]),
      topN: 5,
    });

    expect(suggestions).toEqual([]);
  });

  test("skips custom games and matches without self", async () => {
    const base = await baseMatch();
    const rounds = [
      roster(
        base,
        [
          { puuid: SELF, team: 100, name: "Me" },
          { puuid: "puuid-custom", team: 100, name: "Custom" },
        ],
        { gameType: "CUSTOM_GAME" },
      ),
      roster(base, [
        { puuid: "puuid-stranger", team: 100, name: "Stranger" },
        { puuid: "puuid-other", team: 100, name: "Other" },
      ]),
    ];

    const suggestions = aggregateTeammates({
      rounds,
      selfPuuids: new Set([SELF]),
      trackedPuuids: new Set([SELF]),
      topN: 5,
    });

    expect(suggestions).toEqual([]);
  });

  test("breaks count ties by most recent game and honors topN", async () => {
    const base = await baseMatch();
    const rounds = [
      roster(
        base,
        [
          { puuid: SELF, team: 100, name: "Me" },
          { puuid: "puuid-old", team: 100, name: "Old" },
        ],
        { end: 1000 },
      ),
      roster(
        base,
        [
          { puuid: SELF, team: 100, name: "Me" },
          { puuid: "puuid-new", team: 100, name: "New" },
        ],
        { end: 9000 },
      ),
    ];

    const suggestions = aggregateTeammates({
      rounds,
      selfPuuids: new Set([SELF]),
      trackedPuuids: new Set([SELF]),
      topN: 1,
    });

    expect(suggestions.map((suggestion) => suggestion.riotId)).toEqual([
      "New#NA1",
    ]);
    expect(suggestions[0]).toMatchObject({ lastPlayedMs: 9000 });
  });
});
