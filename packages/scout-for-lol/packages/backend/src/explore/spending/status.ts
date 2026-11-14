import type { DiscordAccountId } from "@scout-for-lol/data";
import {
  exploreModelPickerEnabled,
  exploreSpendPolicy,
} from "#src/config/dynamic.ts";
import { exploreSpendingStatus } from "#src/explore/spending/ledger.ts";
import { durableExploreQuotaStatus } from "#src/temporal/durable-quota.ts";

/**
 * What an Explore user may still spend, for a caller already admitted by
 * `assertExploreAccess`. The web procedure and the desktop route both answer
 * from this, so the two surfaces never disagree about a remaining quota.
 */
export async function exploreStatusFor(userId: DiscordAccountId) {
  const status = await durableExploreQuotaStatus(userId);
  return {
    modelPickerEnabled: exploreModelPickerEnabled(),
    spending: await exploreSpendingStatus(userId, exploreSpendPolicy()),
    quota: status.quota,
  };
}
