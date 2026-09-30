import { getChampionDisplayName, RegionSchema } from "@scout-for-lol/data";
import {
  getChampionMasterySnapshot,
  topChampionMastery,
} from "#src/league/champion-mastery/snapshots.ts";
import {
  latestRanks,
  type ProfileAccount,
} from "#src/lib/player-profile/profile-resolution.ts";

export async function accountSummaries(accounts: ProfileAccount[]) {
  return Promise.all(
    accounts.map(async (account) => {
      const [ranks, mastery] = await Promise.all([
        latestRanks([account.puuid]),
        getChampionMasterySnapshot({
          puuid: account.puuid,
          region: RegionSchema.parse(account.region),
        }),
      ]);
      return {
        gameName: account.riotGameName,
        tagLine: account.riotTagLine,
        region: account.region,
        riotIdUpdatedAt: account.riotIdUpdatedAt,
        lastMatchTime: account.lastMatchTime,
        lastCheckedAt: account.lastCheckedAt,
        ranks,
        mastery:
          mastery === undefined
            ? null
            : {
                fetchedAt: mastery.fetchedAt,
                freshness: mastery.freshness,
                champions: topChampionMastery(mastery.entries, 5).map(
                  (entry) => ({
                    championId: entry.championId,
                    championName: getChampionDisplayName(entry.championId),
                    level: entry.championLevel,
                    points: entry.championPoints,
                    lastPlayedAt: new Date(entry.lastPlayTime),
                  }),
                ),
              },
      };
    }),
  );
}
