import { describe, expect, test } from "vitest";
import {
  BucksTeamChoiceSchema,
  shortTeamName,
  subjectWinsForTeam,
  teamIdForChoice,
  teamIdForSubjectOutcome,
  teamName,
} from "#src/betting/team.ts";

describe("Bryan Bucks team mapping", () => {
  test("maps Discord choices to Riot team IDs", () => {
    expect(teamIdForChoice(BucksTeamChoiceSchema.parse("blue"))).toBe(100);
    expect(teamIdForChoice(BucksTeamChoiceSchema.parse("red"))).toBe(200);
    expect(BucksTeamChoiceSchema.safeParse("green").success).toBe(false);
  });

  test("formats the shared Blue and Red labels", () => {
    expect(shortTeamName(100)).toBe("Blue");
    expect(shortTeamName(200)).toBe("Red");
    expect(teamName(100)).toBe("Blue Team");
    expect(teamName(200)).toBe("Red Team");
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
});
