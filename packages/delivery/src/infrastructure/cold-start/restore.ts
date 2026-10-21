import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import {
  ColdStartReceiptSchema,
  ColdStartSnapshotSchema,
  ReconcileAfterRestoreResultSchema,
  RestoreHoldSchema,
  SettleRestoreHoldSchema,
  type ColdStartReceipt,
  type ColdStartSnapshot,
  type SettleRestoreHold,
} from "#shared/model/cold-start-contract.ts";
import { applicationsOf } from "#shared/model/recipe-view.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { evidence, id } from "#infrastructure/delivery-data.ts";
import { audit, lock, wire } from "#infrastructure/delivery-records.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import {
  bootstrapChain,
  coldStartSnapshot,
  snapshotFingerprint,
} from "./snapshot.ts";

/** Whether this acceptance moves the bootstrap chain, with the snapshot to write off-cluster. */
export async function coldStartRequirement(
  this: Delivery,
  deploymentId: string,
) {
  const row = await this.database.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  const env = await this.database.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  if (env.acceptedDeploymentId !== row.id) return { required: false as const };
  const chain = await bootstrapChain(this.database);
  if (!chain.includes(env.id)) return { required: false as const };
  const { snapshot, fingerprint } = await coldStartSnapshot(
    this.database,
    row.id,
    new Date(),
  );
  return { required: true as const, fingerprint, snapshot };
}

/** The executor wrote the snapshot off-cluster; the receipt is the acceptance's backup evidence. */
export async function recordColdStartReceipt(
  this: Delivery,
  deploymentId: string,
  raw: ColdStartReceipt,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const receipt = ColdStartReceiptSchema.parse(raw);
  await this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    await evidence(
      tx,
      deploymentId,
      [
        {
          kind: "backup",
          operationId: receipt.fingerprint,
          summary: JSON.stringify({ adapter: "cold-start", ...receipt }),
        },
      ],
      { prefix: "cold-start", appendOnly: true },
    );
  });
  return receipt;
}

const ApplicationOperation = z.object({
  status: z
    .object({
      operationState: z
        .object({
          operation: z.object({
            info: z
              .array(z.object({ name: z.string(), value: z.string() }))
              .default([]),
          }),
        })
        .optional(),
    })
    .optional(),
});

type Live = "matches" | "differs" | "missing" | "not-observed";

/** Live readback through the projected reader for single-Application targets (D5). */
async function observeLive(
  this: Delivery,
  readApplication: ApplicationReader | undefined,
  accepted: ColdStartSnapshot["environments"][number]["accepted"],
): Promise<Live> {
  if (readApplication === undefined || accepted === null) return "not-observed";
  const recipe = PipelineRevisionSchema.parse(
    wire(
      await this.database.pipeline.findUniqueOrThrow({
        where: { id: accepted.recipeRevisionId },
      }),
    ),
  );
  const applications = applicationsOf(recipe.definition);
  const [application] = applications;
  if (application === undefined || applications.length !== 1)
    return "not-observed";
  const raw = await readApplication(application.name);
  if (raw === null) return "missing";
  const info =
    ApplicationOperation.parse(raw).status?.operationState?.operation.info ??
    [];
  const request = info.find((entry) => entry.name === "ci.sjer.red/request-id");
  return accepted.operationId !== null &&
    request?.value === accepted.operationId
    ? "matches"
    : "differs";
}

function mismatch(
  record: string | null,
  snapshot: string | null,
  live: Live,
): string | null {
  if (record !== snapshot)
    return `record accepts ${record ?? "nothing"} but the snapshot accepts ${snapshot ?? "nothing"}`;
  if (live === "differs")
    return "the live target's last operation is not the accepted deployment's";
  return live === "missing" ? "the live target does not exist" : null;
}

/**
 * Section 6: compare record, snapshot and live target for every environment
 * and hold automatic deployments on each mismatch until an operator accepts
 * the live state with evidence or a deployment is accepted there. Never
 * moves an accepted pointer.
 */
export async function reconcileAfterRestore(
  this: Delivery,
  raw: unknown,
  actor: Principal,
  readApplication?: ApplicationReader,
) {
  requireScope(actor, "admin");
  const snapshot = ColdStartSnapshotSchema.parse(raw);
  const snapshotDigest = snapshotFingerprint(snapshot);
  const fromSnapshot = new Map(
    snapshot.environments.map((env) => [env.id, env]),
  );
  const environments = await this.database.environment.findMany({
    where: { lifecycle: { not: "retired" } },
    orderBy: { id: "asc" },
  });
  const current = await coldStartSnapshot(this.database, "restore", new Date());
  const recorded = new Map(
    current.snapshot.environments.map((env) => [env.id, env]),
  );
  const comparisons = [];
  for (const env of environments) {
    const accepted = recorded.get(env.id)?.accepted ?? null;
    const snapshotAccepted =
      fromSnapshot.get(env.id)?.accepted?.deploymentId ?? null;
    const live = await observeLive.call(this, readApplication, accepted);
    const reason = mismatch(env.acceptedDeploymentId, snapshotAccepted, live);
    if (reason !== null)
      await this.database.$transaction(async (tx) => {
        await lock(tx, `environment:${env.id}`);
        await tx.environment.update({
          where: { id: env.id },
          data: {
            restoreHold: RestoreHoldSchema.parse({
              snapshotFingerprint: snapshotDigest,
              reason,
              heldAt: new Date().toISOString(),
            }),
          },
        });
        await audit(tx, actor, {
          action: "environment.restore_held",
          entityId: env.id,
          requestId: id(),
          metadata: { reason, snapshotFingerprint: snapshotDigest, live },
        });
      });
    comparisons.push({
      environmentId: env.id,
      record: env.acceptedDeploymentId,
      snapshot: snapshotAccepted,
      live,
      held: reason !== null,
      reason,
    });
  }
  return ReconcileAfterRestoreResultSchema.parse({
    snapshotFingerprint: snapshotDigest,
    environments: comparisons,
  });
}

/** An operator accepts the live state after a restore with evidence; the hold clears. */
export async function settleRestoreHold(
  this: Delivery,
  environmentId: string,
  raw: SettleRestoreHold,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = SettleRestoreHoldSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `environment:${environmentId}`);
    const env = await tx.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    if (env.restoreHold === null)
      throw new DeliveryError(
        "CONFLICT",
        "Environment holds no restore mismatch",
      );
    const hold = RestoreHoldSchema.parse(env.restoreHold);
    if (env.acceptedDeploymentId !== null)
      await evidence(
        tx,
        env.acceptedDeploymentId,
        [
          {
            kind: "reconciliation",
            summary: JSON.stringify({
              adapter: "reconcile-after-restore",
              snapshotFingerprint: hold.snapshotFingerprint,
              reason: input.reason,
              evidence: input.evidence,
            }),
          },
        ],
        { prefix: "restore", appendOnly: true },
      );
    await tx.environment.update({
      where: { id: environmentId },
      data: { restoreHold: Prisma.DbNull },
    });
    await audit(tx, actor, {
      action: "environment.restore_accepted",
      entityId: environmentId,
      requestId: id(),
      metadata: { hold, reason: input.reason },
    });
    return { environmentId, cleared: hold };
  });
}
