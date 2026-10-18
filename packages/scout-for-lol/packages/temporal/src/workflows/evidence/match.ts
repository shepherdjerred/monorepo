import { deprecatePatch, sleep } from "@temporalio/workflow";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  MatchProcessingPolicy,
  ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type { ScoutStage } from "#src/contracts.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "#src/match-receipts.ts";
import { realtimePipelineActivities } from "#src/workflows/activity-options.ts";

/**
 * Retired beta-only gates. Prod never evaluated them, so prod histories carry
 * no marker and prod still records none. Every beta run that could take the
 * old branch has closed. Remove the `deprecatePatch` calls in a release after
 * this one.
 */
export const SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH =
  "scout-match-evidence-preparation";
export const SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH =
  "scout-archive-only-no-effects";

/** New timers are beta-only; the Activity owns the persisted deadline. */
export async function waitForMatchEvidence(
  stage: ScoutStage,
  matchId: RiotMatchId,
): Promise<void> {
  if (stage !== "beta") return;
  deprecatePatch(SCOUT_MATCH_EVIDENCE_PREPARATION_PATCH);
  const activities = realtimePipelineActivities(stage);
  for (;;) {
    const prepared = await activities.prepareMatchEvidence({
      stage,
      riotMatchId: matchId,
    });
    if (prepared.kind === "ready") return;
    await sleep(
      Math.min(30_000, Math.max(1, Date.parse(prepared.retryAt) - Date.now())),
    );
  }
}

/** Retained histories preserve their command sequence; new historical/capture-only work has no finalization. */
export function shouldFinalizeTournament(
  stage: ScoutStage,
  policy: MatchProcessingPolicy,
  attested: ReadonlySet<ReceiptKind>,
): boolean {
  if (
    policy === "HISTORY_ONLY" ||
    attested.has(SCOUT_MATCH_RECEIPT_KINDS.tournament)
  )
    return false;
  if (stage !== "beta" || policy === "FULL") return true;
  // Beta archive-only work: the marker records exactly where the gate did.
  deprecatePatch(SCOUT_ARCHIVE_ONLY_NO_EFFECTS_PATCH);
  return false;
}
