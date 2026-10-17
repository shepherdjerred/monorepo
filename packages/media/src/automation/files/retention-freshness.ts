import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import {
  FileGuardError,
  now,
  type FileContext,
  type RemovalEntry,
} from "./types.ts";

export const RetentionEpochSchema = z.object({
  recoveryEpoch: z.number().int(),
});
const RetentionEvidenceSchema = RetentionEpochSchema.extend({
  authorizedAt: z.iso.datetime(),
});

export function requireFreshRetentionStart(
  context: FileContext,
  evidence: unknown,
): void {
  const proof = RetentionEvidenceSchema.parse(evidence);
  const age = now(context).getTime() - Date.parse(proof.authorizedAt);
  if (age < 0 || age > 60_000) throw new FileGuardError("evidence_stale");
}

/** Keep the sealed process-local proof, with no PG/path locks held, while Temporal refreshes authority. */
export async function awaitRetentionFreshness(
  context: FileContext,
  input: {
    decisionId: string;
    plan: RemovalEntry[];
    epoch: number;
    purge: boolean;
  },
): Promise<void> {
  const deadline = performance.now() + 30_000;
  const completeState = input.purge ? "purged" : "quarantined";
  const expectedState = input.purge ? "quarantined" : "grace_period";
  const generations = new Map(
    input.plan.flatMap((entry) => Object.entries(entry.generations)),
  );
  for (;;) {
    await context.checkpoint("retention-authority-wait");
    const decision = await context.db.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
    });
    if (decision.state === completeState) return;
    if (decision.state !== expectedState)
      throw new FileGuardError("decision_obsolete");
    await assertCurrentIntents(context, generations, input.epoch);
    const evidence = RetentionEvidenceSchema.parse(decision.evidence);
    if (evidence.recoveryEpoch !== input.epoch)
      throw new FileGuardError("recovery_epoch_changed");
    const age = now(context).getTime() - Date.parse(evidence.authorizedAt);
    if (age < 0) throw new FileGuardError("evidence_stale");
    // Use the same authority bound as the final guard; a slower observation must
    // not defer evidence that is still valid. Every effect rechecks the bound.
    if (age <= 60_000) return;
    if (performance.now() >= deadline)
      throw new FileGuardError("retention_refresh_timeout");
    await setTimeout(250);
  }
}

async function assertCurrentIntents(
  context: FileContext,
  generations: Map<string, number>,
  epoch: number,
): Promise<void> {
  const intents = await context.db.mediaIntent.findMany({
    where: { mediaId: { in: [...generations.keys()] } },
  });
  if (
    intents.length !== generations.size ||
    intents.some(
      (intent) =>
        intent.generation !== generations.get(intent.mediaId) ||
        intent.automationEpoch !== epoch,
    )
  )
    throw new FileGuardError("decision_obsolete");
}
