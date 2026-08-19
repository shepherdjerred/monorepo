import { z } from "zod";
import type { RiotTeamId } from "@scout-for-lol/data";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";

export const BucksTeamChoiceSchema = z.enum(["blue", "red"]);

export type BucksTeamChoice = z.infer<typeof BucksTeamChoiceSchema>;

export const BETTING_TEAM_IDS: readonly RiotTeamId[] = [
  BLUE_TEAM_ID,
  RED_TEAM_ID,
];

export function teamIdForChoice(choice: BucksTeamChoice): RiotTeamId {
  return choice === "blue" ? BLUE_TEAM_ID : RED_TEAM_ID;
}

export function shortTeamName(teamId: RiotTeamId): "Blue" | "Red" {
  return teamId === BLUE_TEAM_ID ? "Blue" : "Red";
}

export function teamName(teamId: RiotTeamId): "Blue Team" | "Red Team" {
  return `${shortTeamName(teamId)} Team`;
}

export function teamIdForSubjectOutcome(
  subjectTeamId: RiotTeamId,
  subjectWins: boolean,
): RiotTeamId {
  if (subjectWins) {
    return subjectTeamId;
  }
  return subjectTeamId === BLUE_TEAM_ID ? RED_TEAM_ID : BLUE_TEAM_ID;
}

export function subjectWinsForTeam(
  subjectTeamId: RiotTeamId,
  selectedTeamId: RiotTeamId,
): boolean {
  return subjectTeamId === selectedTeamId;
}
