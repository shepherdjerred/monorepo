import {
  isArenaQueueOrMode,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import { clientRosterCompletion } from "#src/league/tasks/prematch/client-bot-roster.ts";
import { isStartedCustomRosterFinal } from "#src/league/tasks/prematch/spectator-roster.ts";

export type PrematchRosterCompletion =
  "listed" | "custom_roster_final" | "client_bots";

export function isPrematchRosterComplete(game: RawCurrentGameInfo): boolean {
  return (
    isArenaQueueOrMode(game.gameQueueConfigId, game.gameMode) ||
    game.participants.length >= 10 ||
    isStartedCustomRosterFinal(game)
  );
}

/** Consumers ask whether the roster is usable; adapters supply missing roster evidence. */
export async function prematchRosterCompletion(
  game: RawCurrentGameInfo,
  observer: LeaguePuuid,
): Promise<PrematchRosterCompletion | null> {
  if (
    isArenaQueueOrMode(game.gameQueueConfigId, game.gameMode) ||
    game.participants.length >= 10
  )
    return "listed";
  if (isStartedCustomRosterFinal(game)) return "custom_roster_final";
  return (await clientRosterCompletion(game, new Set([observer]))) === null
    ? null
    : "client_bots";
}

export async function isPrematchRosterReady(
  game: RawCurrentGameInfo,
  observer: LeaguePuuid,
): Promise<boolean> {
  return (await prematchRosterCompletion(game, observer)) !== null;
}
