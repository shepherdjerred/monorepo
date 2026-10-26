import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { MountEvidenceSchema } from "#shared/legacy-observer.ts";
import { snapshotHash } from "#migration/profile-import.ts";

/** Synthetic historical-format FIRST births with unrelated source controllers.
 * No existing receipt/plan is rewritten and no current storage authority is granted.
 */
export async function seedUnrelatedStorageHistory(
  db: Database,
  sourceReceiptId: string,
) {
  const source = await db.mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: sourceReceiptId },
    include: { plan: true },
  });
  const selection = z
    .object({
      networkEvidence: z.object({
        configurationDigest: z.string(),
        mounts: MountEvidenceSchema.shape.bindings,
      }),
    })
    .parse(source.selection);
  const scope = z.record(z.string(), z.json()).parse(source.plan.scope);
  for (let index = 0; index < 12; index++) {
    const network = {
      ...selection.networkEvidence,
      mounts: selection.networkEvidence.mounts.map((binding) => ({
        ...binding,
        source: {
          ...binding.source,
          deploymentUid: `unrelated-synthetic-${String(index)}`,
        },
      })),
    };
    const finished = {
      schemaVersion: 1,
      scopeHash: snapshotHash(scope),
      network,
      files: [],
    };
    const planHash = snapshotHash(z.json().parse(finished));
    const plan = await db.mediaHandoffPlan.create({
      data: {
        bundleReviewId: source.plan.bundleReviewId,
        actorId: source.actorId,
        recoveryEpoch: source.recoveryEpoch,
        runtimeVersion: source.previousRuntimeVersion,
        bundleReviewVersion: source.plan.bundleReviewVersion,
        requestHash: snapshotHash({ syntheticHistoricalStorage: index }),
        scope,
        state: "applied",
        plan: finished,
        planHash,
      },
    });
    await db.mediaHandoffReceipt.create({
      data: {
        planId: plan.id,
        planHash,
        actorId: source.actorId,
        recoveryEpoch: source.recoveryEpoch,
        previousRuntimeVersion: source.previousRuntimeVersion,
        runtimeVersion: source.runtimeVersion,
        selection: { networkEvidence: network },
      },
    });
  }
}
