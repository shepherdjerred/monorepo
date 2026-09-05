import { describe, expect, test } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import {
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
  groundedParticipantFields,
  groundedTeamObjectives,
} from "#src/betting/parlays/parlay-stat-fields.ts";
import { flattenMatch } from "#src/report-lake/flatten.ts";

async function loadRiftMatch(): Promise<RawMatch> {
  const file = Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  );
  return RawMatchSchema.parse(await file.json());
}

describe("parlay history groundability", () => {
  test("every grounded field names a column flattenMatch actually writes", async () => {
    const match = await loadRiftMatch();
    const row = flattenMatch(match)[0];
    if (row === undefined) {
      throw new Error("fixture produced no lake rows");
    }
    for (const field of groundedParticipantFields()) {
      const column = PARLAY_HISTORY_COLUMNS[field];
      if (column === null) {
        throw new Error(`${field} reported as grounded but maps to null`);
      }
      // A mapping that names a column the flattener never populates would
      // produce a silently empty distribution rather than a hard failure.
      expect(row[column]).toBeDefined();
      expect(typeof row[column]).toBe("number");
    }
  });

  test("ungrounded fields are absent from the proposable set", () => {
    const grounded = new Set(groundedParticipantFields());
    // Spot-check the classes we deliberately cannot price: ability casts and
    // purchases are not in the lake at all.
    expect(grounded.has("spell1Casts")).toBe(false);
    expect(grounded.has("itemsPurchased")).toBe(false);
    expect(grounded.has("objectivesStolen")).toBe(false);
    // And one we added columns for precisely so it stays proposable.
    expect(grounded.has("magicDamageDealtToChampions")).toBe(true);
  });

  // History reconstructs a team's objective count by summing the participant
  // column that records who landed the blow, because the lake stores
  // participants and not info.teams[].objectives. Settlement reads the
  // authoritative block, so a drift here would misprice legs while still
  // settling them correctly — invisible without this test.
  test("summing participants reproduces the authoritative team objective counts", async () => {
    const match = await loadRiftMatch();
    for (const team of match.info.teams) {
      const participants = match.info.participants.filter(
        (participant) => participant.teamId === team.teamId,
      );
      for (const objective of groundedTeamObjectives()) {
        const column = TEAM_OBJECTIVE_HISTORY_COLUMNS[objective];
        if (column === null) {
          throw new Error(`${objective} reported as grounded but maps to null`);
        }
        const summed = participants.reduce((total, participant) => {
          const row = flattenMatch(match).find(
            (candidate) => candidate.puuid === participant.puuid,
          );
          const value = row?.[column];
          return total + (typeof value === "number" ? value : 0);
        }, 0);
        expect(summed).toBe(team.objectives[objective].kills);
      }
    }
  });

  test("riftHerald is not groundable — no participant column records it", () => {
    expect(TEAM_OBJECTIVE_HISTORY_COLUMNS.riftHerald).toBeNull();
    expect(groundedTeamObjectives()).not.toContain("riftHerald");
  });
});
