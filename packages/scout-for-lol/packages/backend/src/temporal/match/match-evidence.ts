import { ScoutMatchEvidencePreparationSchema } from "@scout-for-lol/temporal/activity-contracts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { completeMatchOf } from "@scout-for-lol/data";
import {
  pinMissingTimeline,
  resolveMatchTimeline,
} from "#src/evidence/timelines.ts";
import { resolveScoutObservedMatchContext } from "./match-context.ts";

/** No payload crosses the Workflow boundary; only a durable wait decision does. */
export async function prepareMatchEvidence(input: {
  riotMatchId: RiotMatchId;
}) {
  const context = await resolveScoutObservedMatchContext(input.riotMatchId);
  const complete = completeMatchOf(context.matchData);
  if (complete === null) {
    // An end-of-game record has no timeline, and none will ever come: the
    // game is frozen without one. Pin the coverage as missing so every
    // timeline reader agrees, and wait for nothing.
    await pinMissingTimeline(input.riotMatchId);
    return ScoutMatchEvidencePreparationSchema.parse({ kind: "ready" });
  }
  const timeline = await resolveMatchTimeline({
    match: complete,
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
