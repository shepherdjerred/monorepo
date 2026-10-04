import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import { rosterIsAsCompleteAsItWillGet } from "#src/league/tasks/prematch/spectator-roster.ts";
import { prisma } from "#src/database/index.ts";
import {
  observedLobbyBots,
  type ObservedLobbyBot,
} from "#src/scout-client/lobby-payload.ts";

/**
 * The bots a tracked player's own client saw in the lobby a game started from.
 *
 * Riot's Spectator API omits bots from `participants` entirely, so a custom
 * played against them reports only its humans for the whole match — which is
 * why the roster looks permanently unfinished to prematch detection. The local
 * client is the only source for the rest of it.
 *
 * Reaching the roster takes two hops, because LCU never puts the two halves in
 * one payload: the lobby knows its `partyId` and the full slot list, and only
 * an in-progress game knows the `gameId`. The client records that join and
 * stamps the recovered lobby identity onto its in-game observations, so this
 * reads the identity from any observation of the game and then the roster from
 * the lobby itself. Both hops are covered by existing indexes
 * (`[gameId, kind]` and `[lobbyId, kind]`).
 *
 * Scoped to observations whose `localPuuid` is a tracked player, and to
 * `ACCEPTED` ones, so an unverified or quarantined device cannot contribute a
 * roster. Returns an empty list whenever no such evidence exists, which is the
 * ordinary case for a matchmade game.
 */
export async function readClientObservedBots(
  gameId: string,
  trackedPuuids: ReadonlySet<string>,
): Promise<readonly ObservedLobbyBot[]> {
  if (trackedPuuids.size === 0) return [];
  const puuids = [...trackedPuuids];
  const joined = await prisma.scoutClientObservation.findFirst({
    where: {
      gameId,
      disposition: "ACCEPTED",
      localPuuid: { in: puuids },
      lobbyId: { not: null },
    },
    orderBy: { capturedAt: "asc" },
    select: { lobbyId: true, capturedAt: true },
  });
  if (joined?.lobbyId == null) return [];
  // The lobby fills up as players and bots are added, so its last observation
  // BEFORE the game is the roster the game started with. Not simply its last
  // one: a party that stays together keeps its `partyId` into the next game,
  // and that game's lobby must not be read back into this one.
  const lobby = await prisma.scoutClientObservation.findFirst({
    where: {
      lobbyId: joined.lobbyId,
      kind: "lobby",
      disposition: "ACCEPTED",
      localPuuid: { in: puuids },
      capturedAt: { lte: joined.capturedAt },
    },
    orderBy: { capturedAt: "desc" },
    select: { payload: true },
  });
  return lobby === null ? [] : observedLobbyBots(lobby.payload);
}

/** How many participants each side has once the client's bots are counted. */
function sideCounts(
  gameInfo: RawCurrentGameInfo,
  bots: readonly ObservedLobbyBot[],
): { readonly blue: number; readonly red: number } {
  let blue = 0;
  let red = 0;
  for (const participant of gameInfo.participants) {
    if (participant.teamId === 100) blue += 1;
    else if (participant.teamId === 200) red += 1;
  }
  for (const bot of bots) {
    if (bot.side === "blue") blue += 1;
    else red += 1;
  }
  return { blue, red };
}

/**
 * The bots that finish a roster Riot will not, or `null` to keep deferring.
 *
 * Prematch defers an undersized Spectator roster because it is nearly always a
 * lobby still loading in. A game against bots is the case where that is wrong
 * and waiting never helps: the roster is final the moment play starts and Riot
 * is never going to list the other nine.
 *
 * So this only speaks up once {@link rosterIsAsCompleteAsItWillGet} says play
 * has begun — a still-filling lobby keeps deferring exactly as before — and
 * only when the client's bots actually make the roster renderable, which needs
 * somebody on both sides. Anything less stays deferred rather than producing a
 * half-empty screen.
 */
export async function clientRosterCompletion(
  gameInfo: RawCurrentGameInfo,
  trackedPuuids: ReadonlySet<string>,
): Promise<readonly ObservedLobbyBot[] | null> {
  if (!rosterIsAsCompleteAsItWillGet(gameInfo)) return null;
  const bots = await readClientObservedBots(
    gameInfo.gameId.toString(),
    trackedPuuids,
  );
  if (bots.length === 0) return null;
  const sides = sideCounts(gameInfo, bots);
  return sides.blue > 0 && sides.red > 0 ? bots : null;
}
