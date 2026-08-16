import type { QueueType } from "@scout-for-lol/data";
import {
  BLUE_TEAM_ID,
  BUCKS_EARNING_QUEUES,
  PARTICIPANTS_PER_TEAM,
  RED_TEAM_ID,
  STANDARD_LOBBY_SIZE,
} from "#src/betting/constants.ts";

/**
 * The single eligibility predicate for Bryan Bucks.
 *
 * Market creation (prematch), the MVP formula, and earning (postmatch) all
 * route through here. Keeping it in one place is what guarantees a game that
 * could be bet on is also a game that can be settled and earned from — three
 * separate predicates would eventually disagree and strand stakes in a market
 * nobody could ever pay out.
 *
 * The shape check is expressed over a structural `{ teamId }` because the
 * prematch caller holds spectator participants and the postmatch caller holds
 * match participants, and the rule is identical for both.
 */

export function isBettableQueue(queueType: QueueType | undefined): boolean {
  if (queueType === undefined) {
    return false;
  }
  return BUCKS_EARNING_QUEUES.includes(queueType);
}

/**
 * A standard 5v5 lobby: exactly ten participants, split five and five across
 * Riot's two team IDs.
 *
 * Arena fails this on participant count (16-18, organized by
 * `playerSubteamId` with no binary team outcome), and a partially-populated
 * spectator lobby fails it on the same check that already makes
 * `active-game-detection` defer.
 */
export function isStandardLobby(
  participants: readonly { teamId: number }[],
): boolean {
  if (participants.length !== STANDARD_LOBBY_SIZE) {
    return false;
  }
  const blue = participants.filter((p) => p.teamId === BLUE_TEAM_ID).length;
  const red = participants.filter((p) => p.teamId === RED_TEAM_ID).length;
  return blue === PARTICIPANTS_PER_TEAM && red === PARTICIPANTS_PER_TEAM;
}

/**
 * Whether a game may carry a betting market at all.
 *
 * Duration and remake status are deliberately NOT checked here: neither is
 * known when the market opens. A game that turns out to be a remake is voided
 * at settlement by `classifyMatchForBetting`, which is the only place that can
 * see the finished result.
 */
export function isBettableGame(input: {
  queueType: QueueType | undefined;
  participants: readonly { teamId: number }[];
}): boolean {
  return (
    isBettableQueue(input.queueType) && isStandardLobby(input.participants)
  );
}
