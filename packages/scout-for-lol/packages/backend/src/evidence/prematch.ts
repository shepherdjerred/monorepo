import type { LeaguePuuid, Region } from "@scout-for-lol/data";
import {
  getActiveGame,
  type SpectatorResult,
} from "#src/league/api/spectator.ts";
import { readClientPrematchEvidence } from "#src/scout-client/prematch-evidence.ts";
import { enrichPrematch } from "#src/scout-client/canonical/local-prematch.ts";
import { optionalSourceRead } from "./source-read.ts";

/** Both adapters contribute independently; an optional outage cannot erase a valid game. */
export async function resolvePrematch(
  puuid: LeaguePuuid,
  region: Region,
): Promise<SpectatorResult> {
  const [riot, client] = await Promise.all([
    getActiveGame(puuid, region),
    optionalSourceRead("SCOUT_CLIENT", () =>
      readClientPrematchEvidence(puuid, region),
    ),
  ]);
  if (riot.kind === "in-game")
    return {
      kind: "in-game",
      game: enrichPrematch(riot.game, client?.identities ?? null),
    };
  if (client?.game != null) return { kind: "in-game", game: client.game };
  if (riot.kind === "unavailable") return riot;
  // A Riot 404 cannot confirm absence for games the client can reveal. Do not
  // close a game-scoped capture permanently when that source failed to answer
  // or has a live identity roster whose full payload is still incomplete.
  return client === undefined || client?.identities != null
    ? {
        kind: "unavailable",
        upstream: false,
        reason: "client-prematch-evidence-pending",
      }
    : riot;
}
