import { patched, sleep } from "@temporalio/workflow";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  MatchProcessingPolicy,
  ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type { ScoutStage } from "#src/contracts.ts";
import { SCOUT_MATCH_RECEIPT_KINDS } from "#src/match-receipts.ts";
import { realtimePipelineActivities } from "#src/workflows/activity-options.ts";

/** New timers are beta-only and replay-gated; the Activity owns the persisted deadline. */
export async function waitForMatchEvidence(
  stage: ScoutStage,
  matchId: RiotMatchId,
): Promise<void> {
  if (stage !== "beta" || !patched("scout-match-evidence-preparation")) return;
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
  return (
    policy !== "HISTORY_ONLY" &&
    !attested.has(SCOUT_MATCH_RECEIPT_KINDS.tournament) &&
    (stage !== "beta" ||
      policy === "FULL" ||
      !patched("scout-archive-only-no-effects"))
  );
}
