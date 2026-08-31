import {
  LeaguePuuidSchema,
  type BucksPoolParticipant,
  type LoadingScreenData,
  type RawCurrentGameInfo,
  type Team,
} from "@scout-for-lol/data";

/**
 * Small adapters between the prematch payloads and the betting model.
 *
 * These exist so `prematch-notification.ts` stays a delivery module: it should
 * not have to know how a spectator participant becomes a pool roster entry, or
 * how to find a tracked player inside a loading screen.
 */

/**
 * Which side of the map the subject is on.
 *
 * Defaults to blue when the subject cannot be found, which only happens for a
 * privacy-scrubbed lobby. Pool creation independently refuses lobbies it
 * cannot read.
 */
export function resolveSubjectTeam(
  loadingScreenData: LoadingScreenData,
  puuid: string,
): Team {
  const participant = loadingScreenData.participants.find(
    (candidate) => candidate.puuid === puuid,
  );
  return participant?.team === "red" ? "red" : "blue";
}

/** The champion the subject locked in, for champion-form lookup. */
export function resolveSubjectChampion(
  loadingScreenData: LoadingScreenData,
  puuid: string,
): string {
  const participant = loadingScreenData.participants.find(
    (candidate) => candidate.puuid === puuid,
  );
  return participant?.championName ?? "";
}

/**
 * The roster the buttons index into.
 *
 * Built from the same spectator payload the pool snapshot uses, so a button's
 * `subjectIndex` and the stored roster cannot disagree.
 */
export function buildRosterForButtons(
  gameInfo: RawCurrentGameInfo,
  trackedAliasByPuuid: ReadonlyMap<string, string>,
): BucksPoolParticipant[] {
  return gameInfo.participants.map((participant) => ({
    puuid:
      participant.puuid === null
        ? null
        : LeaguePuuidSchema.parse(participant.puuid),
    teamId: participant.teamId === 100 ? (100 as const) : (200 as const),
    championId: participant.championId,
    riotId: participant.riotId,
    trackedAlias:
      participant.puuid === null
        ? undefined
        : trackedAliasByPuuid.get(participant.puuid),
  }));
}
