import { z } from "zod";
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
 * Who may produce a saved plan and from what source: a v1 tofu-plan
 * deployment from its frozen snapshot, or a model tofu recipe's plan step
 * from the stack archive its set revision selects (X8). `stack` is null
 * when the row produces no plan.
 */
async function planProducer(tx: Transaction, row: PlanRow) {
  if (row.platformSnapshot !== null) {
    const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
    return snapshot.kind === "tofu-plan" && row.kind === "tofu-plan"
      ? {
          stack: snapshot.stack,
          sourceBuildId: snapshot.source.id,
          sourceRevision: snapshot.source.sourceRevision,
          stageKey: "tofu-plan",
        }
      : {
          stack: null,
          sourceBuildId: null,
          sourceRevision: null,
          stageKey: "",
        };
  }
  const recipe = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: row.pipelineRevisionId } }),
        "Recipe",
      ),
    ),
  ).definition;
  if (recipe.kind !== "tofu" || !("archiveComponent" in recipe))
    return {
      stack: null,
      sourceBuildId: null,
      sourceRevision: null,
      stageKey: "",
    };
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
    stageKey: stepStageKey("step", "plan"),
  };
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

export const ApproveTofuPlanSchema = z.strictObject({
  planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  reason: z.string().trim().min(1).max(4000),
});
export type ApproveTofuPlan = z.infer<typeof ApproveTofuPlanSchema>;

/**
 * The approve step of a model tofu recipe (section 5): a human approves the
 * exact unexpired saved plan this deployment produced before it applies.
 */
export async function approveTofuPlan(
  this: Delivery,
  deploymentId: string,
  raw: ApproveTofuPlan,
  actor: Principal,
) {
  requireScope(actor, "approve");
  const input = ApproveTofuPlanSchema.parse(raw);
  const row = await this.database.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  const recipe = PipelineRevisionSchema.parse(
    wire(
      await this.database.pipeline.findUniqueOrThrow({
        where: { id: row.pipelineRevisionId },
      }),
    ),
  ).definition;
  if (
    recipe.kind !== "tofu" ||
    !("steps" in recipe) ||
    !recipe.steps.some((step) => step.kind === "approve")
  )
    throw new DeliveryError(
      "INVALID",
      "Only a model tofu recipe with an approve step takes a plan approval",
    );
  const plan = TofuPlanReceiptSchema.parse(
    required(
      await this.database.platformPlan.findUnique({ where: { deploymentId } }),
      "Saved plan of this deployment",
    ).receipt,
  );
  if (
    plan.planDigest !== input.planDigest ||
    Date.parse(plan.expiresAt) <= Date.now()
  )
    throw new DeliveryError(
      "CONFLICT",
      "Approval must name this deployment's exact unexpired saved plan",
    );
  return this.stage(
    deploymentId,
    {
      key: PLAN_APPROVAL_STAGE_KEY,
      status: "succeeded",
      operationId: plan.planDigest,
      message: `Approved by ${actor.id}`,
      evidence: [
        {
          kind: "preflight",
          operationId: plan.planDigest,
          summary: JSON.stringify({
            adapter: "tofu-plan-approval",
            approver: actor.id,
            planDigest: plan.planDigest,
            changes: plan.changes,
            reason: input.reason,
          }),
        },
      ],
    },
    actor,
  );
}
