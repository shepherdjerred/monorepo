import type { CollectionStatus } from "#lib/brim/cache.ts";
import {
  withoutQuotaData,
  type RankedEntry,
  type RankResult,
} from "#lib/brim/rank.ts";

export function withCollectionStatus(
  result: RankResult,
  collector: CollectionStatus,
): RankResult {
  if (!collector.active) {
    return withoutQuotaData(
      "Brim collector is inactive on this machine. Open Brim and enable launch at login.",
    );
  }
  const failed = (entry: RankedEntry) =>
    collector.failures[entry.provider] !== undefined;
  return {
    ranked: result.ranked.filter((entry) => !failed(entry)),
    other: result.other.filter((entry) => !failed(entry)),
    unavailable: [
      ...result.unavailable,
      ...result.ranked.filter((entry) => failed(entry)),
      ...result.other.filter((entry) => failed(entry)),
    ].map((entry) => {
      const reason = collector.failures[entry.provider];
      return reason === undefined
        ? entry
        : { ...entry, available: false, reason };
    }),
  };
}
