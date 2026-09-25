import {
  isArenaQueueOrMode,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";

/**
 * A standard or ARAM roster is exactly 10 players; Arena is 16/18 and is
 * validated by its own schema.
 */
export const STANDARD_PARTICIPANT_COUNT = 10;

/**
 * Whether the Spectator snapshot is short of a full roster.
 *
 * Almost always the pre-game countdown: Riot surfaces a game before everyone
 * has loaded in, and the payload then reports fewer than 10 participants. This
 * is not custom-only — matched event modes routinely arrive with 2-4 of 10.
 */
export function isLikelyPreStartLobby(gameInfo: RawCurrentGameInfo): boolean {
  return (
    !isArenaQueueOrMode(gameInfo.gameQueueConfigId, gameInfo.gameMode) &&
    gameInfo.participants.length < STANDARD_PARTICIPANT_COUNT
  );
}

/**
 * Whether a short roster is still filling, or is simply the roster.
 *
 * `gameLength` is negative during the loading screen and counts up once play
 * starts, so a positive value says the snapshot is as complete as Riot intends
 * to make it. The two cases look identical to {@link isLikelyPreStartLobby}
 * but are not the same fact, and conflating them hides a real gap: Riot omits
 * bots from the Spectator roster entirely, so a custom played against nine of
 * them reports one participant for as long as the game lasts. Retrying that on
 * every 30-second tick is not waiting for anything.
 *
 * Both still defer — a one-participant payload cannot render a loading screen,
 * whose schema needs at least two players with someone on each side — but
 * telling them apart is what makes the difference visible instead of silent.
 */
export function rosterIsAsCompleteAsItWillGet(
  gameInfo: RawCurrentGameInfo,
): boolean {
  return gameInfo.gameLength >= 0;
}
