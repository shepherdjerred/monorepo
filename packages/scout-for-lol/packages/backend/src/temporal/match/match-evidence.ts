import { ScoutMatchEvidencePreparationSchema } from "@scout-for-lol/temporal/activity-contracts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { resolveMatchTimeline } from "#src/evidence/timelines.ts";
import { resolveScoutObservedMatchContext } from "./match-context.ts";

/** No payload crosses the Workflow boundary; only a durable wait decision does. */
export async function prepareMatchEvidence(input: {
  riotMatchId: RiotMatchId;
}) {
  const context = await resolveScoutObservedMatchContext(input.riotMatchId);
  const timeline = await resolveMatchTimeline({
    match: context.matchData,
    players: context.trackedPlayers,
    persistence: "required_if_available",
  });
  if (timeline.kind === "conflict")
    throw new Error(`Conflicting timeline evidence for ${input.riotMatchId}`);
  return ScoutMatchEvidencePreparationSchema.parse(
    timeline.kind === "pending"
      ? { kind: "pending", retryAt: timeline.retryAt }
      : { kind: "ready" },
  );
}
