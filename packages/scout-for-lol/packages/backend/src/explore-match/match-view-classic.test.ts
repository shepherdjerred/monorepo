import { describe, expect, test } from "vitest";
import {
  ExploreMatchSnapshotSchema,
  type CanonicalMatch,
  type MatchLakeRow,
  type MatchTeamLakeRow,
} from "@scout-for-lol/data";
import {
  exploreMatchSnapshot,
  isExploreMatchSnapshotSupported,
} from "#src/explore-match/match-view.ts";
import {
  matchRowLoadout,
  orderMatchRows,
} from "#src/explore-match/match-row-view.ts";
import { flattenMatch, flattenMatchTeams } from "#src/report-lake/flatten.ts";
import {
  MatchParticipantRowSchema,
  type LakeMatchParticipantRow,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { convertLcuMatchBundle } from "#src/scout-client/canonical/lcu-match.ts";
import {
  aliasedLcuBundle,
  lcuBotBundle,
  lcuBundleMatchId,
} from "#src/testing/report-lake/lcu-bundle-fixtures.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

/** What the lake read returns for a flattened row: its time as epoch milliseconds. */
function lakeRead(row: MatchLakeRow): LakeMatchParticipantRow {
  return MatchParticipantRowSchema.parse({
    ...row,
    game_creation_ms:
      row.game_creation_at === null
        ? null
        : Date.parse(`${row.game_creation_at.replace(" ", "T")}Z`),
  });
}

function lakeRows(match: CanonicalMatch): {
  rows: LakeMatchParticipantRow[];
  teams: MatchTeamLakeRow[];
} {
  return {
    rows: flattenMatch(match).map((row) => lakeRead(row)),
    teams: flattenMatchTeams(match),
  };
}

async function completeClassic(): Promise<CanonicalMatch> {
  const bundle = await aliasedLcuBundle("lcu-postgame-classic");
  const match = convertLcuMatchBundle(lcuBundleMatchId(bundle), bundle);
  if (match === null) throw new Error("The Classic bundle must convert");
  return match;
}

describe("which modes the Explore match snapshot supports", () => {
  test("accepts Classic modes and refuses Arena", () => {
    expect(isExploreMatchSnapshotSupported(4310, "JADE")).toBe(true);
    expect(isExploreMatchSnapshotSupported(2450, "KIWI_JADE")).toBe(true);
    expect(isExploreMatchSnapshotSupported(1700, "CHERRY")).toBe(false);
  });
});

describe("a League Classic match", () => {
  test("snapshots the converted client post-game in roster order", async () => {
    const { rows, teams } = lakeRows(await completeClassic());
    const snapshot = exploreMatchSnapshot(rows, teams);

    expect(ExploreMatchSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.queueId).toBe(4310);
    expect(snapshot.gameMode).toBe("JADE");
    expect(snapshot.gameCreationMs).not.toBeNull();
    expect(snapshot.gameVersion).toBe("16.20.824.8524");
    expect(snapshot.teams.map((team) => team.teamId)).toEqual([100, 200]);
    for (const team of snapshot.teams) {
      expect(team.participants).toHaveLength(5);
      expect(team.objectives).not.toBeNull();
      expect(
        team.participants.map((participant) => participant.participantId),
      ).toEqual(
        team.participants
          .flatMap((participant) =>
            participant.participantId === null
              ? []
              : [participant.participantId],
          )
          .toSorted((left, right) => left - right),
      );
      for (const participant of team.participants) {
        // Classic champions are `Jade_*` asset keys resolved by id.
        expect(participant.championName).toMatch(/^Jade_/);
        expect(participant.championId).toBeGreaterThan(60_000);
      }
    }
  });

  test("resolves summoner spells onto Classic spell ids", async () => {
    const { rows } = lakeRows(await completeClassic());
    const first = rows[0];
    if (first === undefined) throw new Error("The Classic fixture has rows");
    const loadout = matchRowLoadout(first);

    expect(loadout.summonerSpellIds).toEqual([
      first.summoner_spell_1_id,
      first.summoner_spell_2_id,
    ]);
    expect(loadout.itemIds).toHaveLength(7);
  });

  test("shows bots without a puuid or an invented identity", async () => {
    const bundle = await lcuBotBundle([6, 7, 8, 9, 10]);
    const match = convertLcuMatchBundle(lcuBundleMatchId(bundle), bundle);
    if (match === null) throw new Error("The bot fixture must convert");
    const { rows, teams } = lakeRows(match);
    const snapshot = exploreMatchSnapshot(rows, teams);

    const participants = snapshot.teams.flatMap((team) => team.participants);
    expect(participants).toHaveLength(10);
    expect(rows.filter((row) => row.puuid === null)).toHaveLength(5);
    for (const participant of participants) {
      expect(JSON.stringify(participant)).not.toContain(
        "00000000-0000-0000-0000-000000000000",
      );
    }
  });
});

describe("a League Classic end-of-game record", () => {
  test("states no participant id, creation time, version or lobby objectives it lacks", async () => {
    const { rows, teams } = lakeRows(await classicEndOfGameMatch());
    expect(rows.every((row) => row.participant_id === null)).toBe(true);
    const snapshot = exploreMatchSnapshot(rows, teams);

    expect(snapshot.gameCreationMs).toBeNull();
    expect(snapshot.gameVersion).toBeNull();
    for (const team of snapshot.teams) {
      expect(team.participants).toHaveLength(5);
      for (const participant of team.participants) {
        expect(participant.participantId).toBeNull();
      }
    }
  });

  test("orders unnumbered rows by team, then champion", async () => {
    const { rows, teams } = lakeRows(await classicEndOfGameMatch());
    const snapshot = exploreMatchSnapshot(rows.toReversed(), teams);

    expect(snapshot.teams.map((team) => team.teamId)).toEqual([100, 200]);
    for (const team of snapshot.teams) {
      const names = team.participants.map(
        (participant) => participant.championName,
      );
      expect(names).toEqual(names.toSorted());
    }
    expect(orderMatchRows(rows.toReversed()).map((row) => row.team_id)).toEqual(
      rows.map((row) => row.team_id).toSorted((left, right) => left - right),
    );
  });

  test("has null team objectives when the lake holds no team rows", async () => {
    const { rows } = lakeRows(await classicEndOfGameMatch());
    const snapshot = exploreMatchSnapshot(rows, []);

    expect(snapshot.teams.map((team) => team.objectives)).toEqual([null, null]);
  });
});
