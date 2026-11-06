import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  MediaNetworkActivities,
  MediaOperation,
} from "#shared/automation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import {
  assertHistoricalMovieRetention,
  HistoricalMovieRetentionProtection,
} from "#infrastructure/recovery/legacy-claims/historical-movie.ts";
import {
  LEGACY_CLAIM_PROTECTION,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";

type Result = Awaited<
  ReturnType<MediaNetworkActivities["evaluateMediaRetention"]>
>;
export function historicalRetentionResult(reason: string): Result {
  return {
    status: reason === "intent_obsolete" ? "obsolete" : "protected",
    reason,
    decisionId: null,
    wakeAt: null,
  };
}

export async function historicalRetentionProtection(
  context: MediaAutomationContext,
  ids: string[],
  input: MediaOperation,
  budget: PublicationAuthorityReadBudget,
) {
  if (ids.length > 500)
    return historicalRetentionResult("coverage_requires_review");
  try {
    return (await reopenLegacyClaimProtection(context.db, ids, (tx, mediaIds) =>
      assertHistoricalMovieRetention(
        tx,
        {
          mediaIds,
          generation: { mediaId: input.mediaId, generation: input.generation },
        },
        budget,
      ),
    ))
      ? historicalRetentionResult(LEGACY_CLAIM_PROTECTION)
      : null;
  } catch (error) {
    if (error instanceof NativeArchiveScopeProtection)
      return historicalRetentionResult(error.code);
    if (!(error instanceof HistoricalMovieRetentionProtection)) throw error;
    return historicalRetentionResult(error.reason);
  }
}
