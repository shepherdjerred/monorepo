import { describe, expect, test } from "bun:test";
import {
  LeaguePuuidSchema,
  type BucksPoolParticipant,
} from "@scout-for-lol/data";
import {
  BucksOutcomeChoiceSchema,
  hasTrackedPlayersOnBothTeams,
  outcomeLabel,
  resolveOutcomeChoice,
  shortTeamName,
  subjectWinsForTeam,
  teamIdForSubjectOutcome,
} from "#src/betting/team.ts";

function participant(
  teamId: 100 | 200,
  tracked: boolean,
  scrubbed = false,
): BucksPoolParticipant {
  return {
    puuid: scrubbed
      ? null
      : LeaguePuuidSchema.parse(
          `puuid-${teamId.toString()}-${String(tracked)}`.padEnd(78, "0"),
        ),
    teamId,
    championId: 1,
    ...(tracked ? { trackedAlias: "alias" } : {}),
  };
}

const BLUE_ANCHOR = { anchorTeamId: 100, mixedTeams: false } as const;
const RED_ANCHOR = { anchorTeamId: 200, mixedTeams: false } as const;
const MIXED = { anchorTeamId: 100, mixedTeams: true } as const;

describe("Bryan Bucks outcome framing", () => {
  test("names the anchor's side WIN and the other LOSE", () => {
    expect(outcomeLabel(100, BLUE_ANCHOR)).toBe("WIN");
    expect(outcomeLabel(200, BLUE_ANCHOR)).toBe("LOSE");
    expect(outcomeLabel(200, RED_ANCHOR)).toBe("WIN");
    expect(outcomeLabel(100, RED_ANCHOR)).toBe("LOSE");
  });

  test("falls back to Blue/Red when both teams are tracked", () => {
    expect(outcomeLabel(100, MIXED)).toBe("Blue");
    expect(outcomeLabel(200, MIXED)).toBe("Red");
  });

  test("falls back to Blue/Red when the caller has no framing", () => {
    expect(outcomeLabel(100, undefined)).toBe("Blue");
    expect(outcomeLabel(200, undefined)).toBe("Red");
  });

  test("detects tracked players on both teams", () => {
    expect(
      hasTrackedPlayersOnBothTeams([
        participant(100, true),
        participant(200, false),
      ]),
    ).toBe(false);
    expect(
      hasTrackedPlayersOnBothTeams([
        participant(100, true),
        participant(200, true),
      ]),
    ).toBe(true);
    // Two tracked players on the SAME team is the case Blue/Red was
    // introduced for, and must not read as mixed.
    expect(
      hasTrackedPlayersOnBothTeams([
        participant(100, true),
        participant(100, true),
      ]),
    ).toBe(false);
  });

  test("a privacy-scrubbed participant cannot make a lobby mixed", () => {
    expect(
      hasTrackedPlayersOnBothTeams([
        participant(100, true),
        participant(200, true, true),
      ]),
    ).toBe(false);
  });
});

describe("Bryan Bucks outcome choices", () => {
  test("resolves win and lose against the anchor", () => {
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("win"), BLUE_ANCHOR),
    ).toEqual({ kind: "resolved", teamId: 100 });
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("lose"), BLUE_ANCHOR),
    ).toEqual({ kind: "resolved", teamId: 200 });
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("win"), RED_ANCHOR),
    ).toEqual({ kind: "resolved", teamId: 200 });
  });

  // The whole reason four static choices work: blue/red need no framing, so
  // they still resolve for the lobby where win/lose cannot.
  test("resolves blue and red without framing, even when mixed", () => {
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("blue"), MIXED),
    ).toEqual({ kind: "resolved", teamId: 100 });
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("red"), MIXED),
    ).toEqual({ kind: "resolved", teamId: 200 });
  });

  test("refuses win and lose for a mixed lobby instead of guessing", () => {
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("win"), MIXED),
    ).toEqual({ kind: "ambiguous" });
    expect(
      resolveOutcomeChoice(BucksOutcomeChoiceSchema.parse("lose"), MIXED),
    ).toEqual({ kind: "ambiguous" });
  });

  test("rejects an unknown choice", () => {
    expect(BucksOutcomeChoiceSchema.safeParse("green").success).toBe(false);
    expect(BucksOutcomeChoiceSchema.safeParse("team").success).toBe(false);
  });
});

describe("Bryan Bucks team mapping", () => {
  test("formats the shared Blue and Red labels", () => {
    expect(shortTeamName(100)).toBe("Blue");
    expect(shortTeamName(200)).toBe("Red");
  });

  test("translates direct choices through anchors on either side", () => {
    expect(subjectWinsForTeam(100, 100)).toBe(true);
    expect(subjectWinsForTeam(100, 200)).toBe(false);
    expect(subjectWinsForTeam(200, 100)).toBe(false);
    expect(subjectWinsForTeam(200, 200)).toBe(true);

    expect(teamIdForSubjectOutcome(100, true)).toBe(100);
    expect(teamIdForSubjectOutcome(100, false)).toBe(200);
    expect(teamIdForSubjectOutcome(200, true)).toBe(200);
    expect(teamIdForSubjectOutcome(200, false)).toBe(100);
  });

  // The two conversions are exact inverses, which is what makes the WIN/LOSE
  // reframe lossless: storage stays team-relative.
  test("round-trips every anchor and selection pair", () => {
    for (const anchor of [100, 200] as const) {
      for (const selected of [100, 200] as const) {
        expect(
          teamIdForSubjectOutcome(anchor, subjectWinsForTeam(anchor, selected)),
        ).toBe(selected);
      }
    }
  });
});
