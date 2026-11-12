import {
  CanonicalMatchRecordSchema,
  EndOfGameMatchSchema,
  MatchLakeRowSchema,
} from "@scout-for-lol/data";
import { MatchTeamLakeRowSchema } from "@scout-for-lol/data/model/reports/match-team-lake-columns.ts";
import { describe, expect, test } from "vitest";
import {
  flattenMatch,
  flattenMatchTeamBans,
  flattenMatchTeams,
} from "#src/report-lake/flatten.ts";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";
import { convertLcuMatchBundle } from "#src/scout-client/canonical/lcu-match.ts";
import { aliasedLcuBundle } from "#src/testing/report-lake/lcu-bundle-fixtures.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

const endOfGame = await classicEndOfGameMatch();
const complete = convertLcuMatchBundle(
  endOfGame.metadata.matchId,
  await aliasedLcuBundle("lcu-postgame-classic"),
);
if (complete === null) throw new Error("The Classic bundle must convert");

/** Columns an end-of-game record cannot state, and the time columns it derives differently. */
const UNSTATED = new Set<string>([
  "participant_id",
  "game_creation_at",
  "game_version",
  "coverage",
  "month",
  "game_start_at",
  "game_end_at",
  // Legacy match-history lane and role; the block states a detected position.
  "lane",
  "role",
]);

function stated(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => !UNSTATED.has(column)),
  );
}

describe("the end-of-game record in storage and the lake", () => {
  test("round-trips through stored JSON as the end-of-game record", () => {
    const text = JSON.stringify(endOfGame);
    const stored = CanonicalMatchRecordSchema.parse(JSON.parse(text));
    expect(stored.coverage).toBe("end_of_game");
    expect(stored.match).toEqual(endOfGame);
  });

  test("a stored record that states a zero for an unknown is refused", () => {
    expect(
      CanonicalMatchRecordSchema.safeParse({
        ...endOfGame,
        info: { ...endOfGame.info, gameCreation: 0 },
      }).success,
    ).toBe(false);
    expect(
      EndOfGameMatchSchema.safeParse({
        ...endOfGame,
        info: {
          ...endOfGame.info,
          teams: endOfGame.info.teams.map((team) => ({
            ...team,
            objectives: {
              ...team.objectives,
              riftHerald: { first: false, kills: 0 },
            },
          })),
        },
      }).success,
    ).toBe(false);
  });

  test("flattenMatch writes coverage end_of_game and NULL for every unknown", () => {
    const rows = flattenMatch(endOfGame);

    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(MatchLakeRowSchema.parse(row)).toEqual(row);
      expect(row).toMatchObject({
        coverage: "end_of_game",
        data_source: "SCOUT_CLIENT",
        participant_id: null,
        game_creation_at: null,
        game_version: null,
        game_start_at: lakeTimestamp(endOfGame.info.gameStartTimestamp),
        month: lakeMonth(endOfGame.info.gameStartTimestamp),
        queue_id: 4310,
      });
    }
  });

  test("flattenMatch states what the history bundle states for the same game", () => {
    const fromBundle = new Map(
      flattenMatch(complete).map((row) => [row.puuid, row]),
    );
    for (const row of flattenMatch(endOfGame)) {
      expect(stated(row)).toEqual(stated(fromBundle.get(row.puuid) ?? {}));
    }
    expect(
      flattenMatch(complete).every((row) => row.coverage === "complete"),
    ).toBe(true);
  });

  test("flattenMatchTeams writes NULL for the objectives no player stat counts", () => {
    const rows = flattenMatchTeams(endOfGame);
    const fromBundle = new Map(
      flattenMatchTeams(complete).map((row) => [row.team_id, row]),
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(MatchTeamLakeRowSchema.parse(row)).toEqual(row);
      expect(row).toMatchObject({
        rift_herald_kills: null,
        first_rift_herald: null,
        void_grub_kills: null,
        first_void_grub: null,
        atakhan_kills: null,
        first_atakhan: null,
        epic_monster_feat_state: null,
        first_blood_feat_state: null,
        first_turret_feat_state: null,
        // Both sides took dragons, so the first is undecided.
        first_dragon: null,
      });
      const twin = fromBundle.get(row.team_id);
      expect(row).toMatchObject({
        win: twin?.win,
        champion_kills: twin?.champion_kills,
        tower_kills: twin?.tower_kills,
        inhibitor_kills: twin?.inhibitor_kills,
        baron_kills: twin?.baron_kills,
        dragon_kills: twin?.dragon_kills,
        first_champion_kill: twin?.first_champion_kill,
        first_tower: twin?.first_tower,
      });
    }
  });

  test("unstated bans write no ban rows", () => {
    expect(flattenMatchTeamBans(endOfGame)).toEqual([]);
  });
});
