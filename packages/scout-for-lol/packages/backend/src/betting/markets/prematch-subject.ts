import {
  LeaguePuuidSchema,
  type BucksPoolParticipant,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";

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
