import {
  PLAN_APPROVAL_STAGE_KEY,
  stepStageKey,
} from "#shared/model/stage-keys.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  PlatformReleaseSnapshotSchema,
  RecordTofuPlanSchema,
  TofuPlanReceiptSchema,
  type RecordTofuPlan,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import {
  fingerprint,
  lock,
  required,
  audit,
  wire,
} from "#infrastructure/delivery-records.ts";
import { artifact, type Transaction } from "#infrastructure/delivery-data.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { nativeReceipt } from "./policy.ts";

type PlanRow = {
  id: string;
  kind: string;
  platformSnapshot: unknown;
  pipelineRevisionId: string;
  versionSetRevisionId: string;
};

/**
 * A model tofu recipe's stack and the stack archive build its set revision
 * froze, which every one of its Tofu steps runs from (X8); null for any
 * other recipe.
 */
export async function modelTofuSource(
  tx: Transaction,
  row: { pipelineRevisionId: string; versionSetRevisionId: string },
) {
  const recipe = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: row.pipelineRevisionId } }),
        "Recipe",
      ),
    ),
  ).definition;
  if (recipe.kind !== "tofu" || !("archiveComponent" in recipe)) return null;
  const entry = required(
    await tx.versionSetEntry.findUnique({
      where: {
        revisionId_component: {
          revisionId: row.versionSetRevisionId,
          component: recipe.archiveComponent,
        },
      },
    }),
    "Frozen stack archive",
  );
  const archive = await artifact(tx, entry.artifactId);
  return {
    stack: recipe.stack,
    sourceBuildId: archive.buildId,
    sourceRevision: archive.sourceRevision,
  };
}

/**
 * Who may produce a saved plan and from what source: a v1 tofu-plan
 * deployment from its frozen snapshot, or a model tofu recipe's plan step
 * from the stack archive its set revision selects (X8). `stack` is null
 * when the row produces no plan.
 */
async function planProducer(tx: Transaction, row: PlanRow) {
  const none = {
    stack: null,
    sourceBuildId: null,
    sourceRevision: null,
    stageKey: "",
  };
  if (row.platformSnapshot !== null) {
    const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
    return snapshot.kind === "tofu-plan" && row.kind === "tofu-plan"
      ? {
          stack: snapshot.stack,
          sourceBuildId: snapshot.source.id,
          sourceRevision: snapshot.source.sourceRevision,
          stageKey: "tofu-plan",
        }
      : none;
  }
  const model = await modelTofuSource(tx, row);
  return model === null
    ? none
    : { ...model, stageKey: stepStageKey("step", "plan") };
}

/** H3: a rejected plan was discarded with its decision and is never saved again. */
async function requireUnrejected(tx: Transaction, deploymentId: string) {
  const decision = await tx.stage.findUnique({
    where: { deploymentId_key: { deploymentId, key: PLAN_APPROVAL_STAGE_KEY } },
  });
  if (decision?.status === "failed")
    throw new DeliveryError(
      "CONFLICT",
      "This deployment's saved plan was rejected and discarded",
    );
}

export async function recordTofuPlan(
  this: Delivery,
  raw: RecordTofuPlan,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = RecordTofuPlanSchema.parse(raw);
  const { receipt } = input;
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${receipt.deploymentId}`);
    const existing = await tx.platformPlan.findUnique({
      where: { deploymentId: receipt.deploymentId },
    });
    if (existing !== null) {
      if (existing.fingerprint !== fingerprint(input))
        throw new DeliveryError(
          "CONFLICT",
          "Saved plan identity and encrypted bytes are immutable",
        );
      return TofuPlanReceiptSchema.parse(existing.receipt);
    }
    await requireUnrejected(tx, receipt.deploymentId);
    const row = required(
      await tx.deployment.findUnique({
        where: { id: receipt.deploymentId },
        include: { environment: true },
      }),
      "Plan deployment",
    );
    const producer = await planProducer(tx, row);
    const stage = await tx.stage.findUnique({
      where: {
        deploymentId_key: { deploymentId: row.id, key: producer.stageKey },
      },
    });
    const held =
      producer.stack === null
        ? null
        : await tx.targetLock.findUnique({
            where: { instance: `stack:${producer.stack}` },
          });
    if (
      producer.stack === null ||
      row.status !== "running" ||
      row.environment.activeDeploymentId !== row.id ||
      held?.deploymentId !== row.id
    )
      throw new DeliveryError(
        "CONFLICT",
        "Saved plan producer no longer owns its exact running stack deployment",
      );
    if (
      stage === null ||
      producer.sourceBuildId !== receipt.sourceBuildId ||
      producer.sourceRevision !== receipt.sourceRevision ||
      producer.stack !== receipt.stack ||
      receipt.nativeJob.requestId !== row.id ||
      fingerprint(nativeReceipt(stage.message)) !==
        fingerprint(receipt.nativeJob)
    )
      throw new DeliveryError(
        "INVALID",
        "Saved plan receipt differs from its frozen source, stack or recorded native Job identity",
      );
    const now = Date.now();
    if (
      Date.parse(receipt.createdAt) > now + 5000 ||
      now - Date.parse(receipt.createdAt) > 2 * 60 * 60 * 1000 ||
      Date.parse(receipt.expiresAt) <= now
    )
      throw new DeliveryError(
        "CONFLICT",
        "Saved plan creation or expiration is outside its execution window",
      );
    await tx.platformPlan.create({
      data: {
        deploymentId: row.id,
        receipt,
        encryptedPlan: input.encryptedPlan,
        fingerprint: fingerprint(input),
      },
    });
    await audit(tx, actor, {
      action: "platform.plan_recorded",
      entityId: row.id,
      requestId: receipt.nativeJob.uid,
      metadata: { planDigest: receipt.planDigest, stack: receipt.stack },
    });
    return receipt;
  });
}

export async function tofuPlan(
  this: Delivery,
  deploymentId: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const row = required(
    await this.database.platformPlan.findUnique({ where: { deploymentId } }),
    "Private saved platform plan",
  );
  return RecordTofuPlanSchema.parse({
    receipt: row.receipt,
    encryptedPlan: row.encryptedPlan,
  });
}
