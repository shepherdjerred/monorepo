import {
  LeaguePuuidSchema,
  type RawCurrentGameInfo,
  type Region,
} from "@scout-for-lol/data/index.ts";
import {
  getChampionMasterySnapshot,
  masteryForChampion,
  type ChampionMasterySnapshot,
} from "#src/league/champion-mastery/snapshots.ts";

export type ParticipantMasteries = ReadonlyMap<
  string,
  ChampionMasterySnapshot | undefined
>;

/** Fetch cached/current snapshots without allowing one player to block a lobby. */
export async function fetchParticipantMasteries(
  gameInfo: RawCurrentGameInfo,
  region: Region,
): Promise<ParticipantMasteries> {
  const lookups = gameInfo.participants.flatMap((participant) =>
    participant.puuid === null
      ? []
      : [
          {
            puuid: participant.puuid,
            request: getChampionMasterySnapshot({
              puuid: LeaguePuuidSchema.parse(participant.puuid),
              region,
            }),
          },
        ],
  );
  const results = await Promise.allSettled(
    lookups.map((lookup) => lookup.request),
  );
  const byPuuid = new Map<string, ChampionMasterySnapshot | undefined>();
  for (const [index, lookup] of lookups.entries()) {
    const result = results[index];
    if (result === undefined) {
      throw new Error(`Missing settled mastery result for ${lookup.puuid}`);
    }
    byPuuid.set(
      lookup.puuid,
      result.status === "fulfilled" ? result.value : undefined,
    );
  }
  return byPuuid;
}

export function withSelectedChampionMastery(
  puuid: string | null,
  championId: number,
  masteries: ParticipantMasteries,
) {
  const snapshot = puuid === null ? undefined : masteries.get(puuid);
  const entry =
    snapshot === undefined
      ? undefined
      : masteryForChampion(snapshot.entries, championId);
  return entry === undefined
    ? {}
    : {
        mastery: { level: entry.championLevel, points: entry.championPoints },
      };
}
