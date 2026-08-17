import type { RawMatch } from "@scout-for-lol/data";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";
import {
  REMAKE_MAX_DURATION_SECONDS,
  STANDARD_LOBBY_SIZE,
} from "#src/betting/constants.ts";
import { isStandardLobby } from "#src/betting/eligibility.ts";

/**
 * What a finished match means for a betting pool.
 *
 * Pure and total: it answers from `RawMatch` alone, with no database and no
 * pool context, so settlement's decision is reproducible from the archived
 * match JSON forever. Pool-dependent voiding (`no_counterparty`, when one side
 * one-sided pools that cannot be matched) is decided by the settler, not here,
 * because it depends on who bet rather than on what happened. Current decided
 * one-sided pools
 * are matched by the audited house account during settlement.
 */
export type MatchBettingOutcome =
  | { kind: "decided"; winningTeamId: number }
  | { kind: "void"; reason: "remake" | "unsupported_mode" };

/**
 * A remake, by the same predicate `report-lake/flatten.ts` uses, plus the two
 * signals that only appear at match level.
 *
 * Note this checks `gameEndedInEarlySurrender`, not `gameEndedInSurrender`: an
 * ordinary surrender at 20 minutes is a real, bettable loss, while an early
 * surrender means the game never properly happened.
 */
function isRemake(matchData: RawMatch): boolean {
  if (matchData.info.endOfGameResult !== "GameComplete") {
    return true;
  }
  if (matchData.info.gameDuration < REMAKE_MAX_DURATION_SECONDS) {
    return true;
  }
  return matchData.info.participants.some(
    (participant) =>
      participant.gameEndedInEarlySurrender || participant.teamEarlySurrendered,
  );
}

/**
 * Riot reports the winner twice — on each team and on each participant. We
 * read `info.teams`, and require the two to agree on exactly one winner.
 *
 * Returning undefined for a draw or a double-win is not defensive padding: a
 * pool with no single winning side genuinely cannot be paid out, and treating
 * a malformed result as a mode we don't support refunds everyone rather than
 * inventing a winner.
 */
function findWinningTeamId(matchData: RawMatch): number | undefined {
  const teams = matchData.info.teams;
  if (teams.length !== 2) {
    return undefined;
  }
  const winners = teams.filter((team) => team.win);
  if (winners.length !== 1) {
    return undefined;
  }
  const winningTeamId = winners[0]?.teamId;
  if (winningTeamId !== BLUE_TEAM_ID && winningTeamId !== RED_TEAM_ID) {
    return undefined;
  }
  return winningTeamId;
}

export function classifyMatchForBetting(
  matchData: RawMatch,
): MatchBettingOutcome {
  if (matchData.info.participants.length !== STANDARD_LOBBY_SIZE) {
    return { kind: "void", reason: "unsupported_mode" };
  }
  if (!isStandardLobby(matchData.info.participants)) {
    return { kind: "void", reason: "unsupported_mode" };
  }

  const winningTeamId = findWinningTeamId(matchData);
  if (winningTeamId === undefined) {
    return { kind: "void", reason: "unsupported_mode" };
  }

  // Shape before remake: a payload we cannot even read a winner from is not
  // "a remake", and labelling it one would put a misleading reason in the
  // ledger.
  if (isRemake(matchData)) {
    return { kind: "void", reason: "remake" };
  }

  return { kind: "decided", winningTeamId };
}
