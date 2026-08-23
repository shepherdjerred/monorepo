import { z } from "zod";
import type { BucksPoolParticipant, RiotTeamId } from "@scout-for-lol/data";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";

/**
 * What `/bb bet` accepts for the wagered outcome.
 *
 * `win`/`lose` are the ordinary framing, relative to the game's tracked
 * anchor. `blue`/`red` exist because slash-command choices are frozen at
 * registration time and cannot vary per game: they are the escape hatch for
 * the rare lobby with tracked players on both teams, where WIN/LOSE names no
 * single outcome.
 */
export const BucksOutcomeChoiceSchema = z.enum(["win", "lose", "blue", "red"]);

export type BucksOutcomeChoice = z.infer<typeof BucksOutcomeChoiceSchema>;

export const BETTING_TEAM_IDS: readonly RiotTeamId[] = [
  BLUE_TEAM_ID,
  RED_TEAM_ID,
];

/**
 * How one game's two outcomes should be named.
 *
 * Storage stays team-relative — `predictedTeamId` remains the authoritative
 * wager and settlement is unchanged — so this is purely a rendering concern.
 */
export type OutcomeFraming = {
  /** The tracked anchor's team. "WIN" means this team wins. */
  anchorTeamId: RiotTeamId;
  /**
   * Both teams carry a tracked player, so "WIN" would be ambiguous and the
   * copy falls back to Blue/Red.
   */
  mixedTeams: boolean;
};

export type OutcomeChoiceResolution =
  { kind: "resolved"; teamId: RiotTeamId } | { kind: "ambiguous" };

/**
 * A roster participant Scout tracks and can name.
 *
 * A privacy-scrubbed participant carries no PUUID, so it can neither anchor a
 * bet nor prove that the other team is tracked.
 */
function isTrackedParticipant(participant: BucksPoolParticipant): boolean {
  return participant.trackedAlias !== undefined && participant.puuid !== null;
}

/** True when tracked players sit on both teams, which makes WIN/LOSE ambiguous. */
export function hasTrackedPlayersOnBothTeams(
  roster: readonly BucksPoolParticipant[],
): boolean {
  const trackedTeamIds = new Set(
    roster
      .filter((participant) => isTrackedParticipant(participant))
      .map((participant) => participant.teamId),
  );
  return trackedTeamIds.size > 1;
}

export function shortTeamName(teamId: RiotTeamId): "Blue" | "Red" {
  return teamId === BLUE_TEAM_ID ? "Blue" : "Red";
}

/**
 * Name one side of a game's binary outcome.
 *
 * Without framing — a caller with no roster in hand — this degrades to the
 * team name, which is also the correct answer for a mixed lobby.
 */
export function outcomeLabel(
  teamId: RiotTeamId,
  framing: OutcomeFraming | undefined,
): "WIN" | "LOSE" | "Blue" | "Red" {
  if (framing === undefined || framing.mixedTeams) {
    return shortTeamName(teamId);
  }
  return teamId === framing.anchorTeamId ? "WIN" : "LOSE";
}

/**
 * Resolve a `/bb bet` choice to the team it wagers on.
 *
 * `blue`/`red` resolve without framing, which is what lets four static choices
 * cover a per-game distinction. `win`/`lose` cannot be resolved for a mixed
 * lobby, and the caller must ask for a side instead of guessing.
 */
export function resolveOutcomeChoice(
  choice: BucksOutcomeChoice,
  framing: OutcomeFraming,
): OutcomeChoiceResolution {
  if (choice === "blue") {
    return { kind: "resolved", teamId: BLUE_TEAM_ID };
  }
  if (choice === "red") {
    return { kind: "resolved", teamId: RED_TEAM_ID };
  }
  if (framing.mixedTeams) {
    return { kind: "ambiguous" };
  }
  return {
    kind: "resolved",
    teamId: teamIdForSubjectOutcome(framing.anchorTeamId, choice === "win"),
  };
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
