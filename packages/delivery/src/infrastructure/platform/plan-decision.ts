import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  TofuPlanReceiptSchema,
  type PipelineRevision,
  type Principal,
  type TofuPlanReceipt,
} from "#shared/contract.ts";
import {
  ApproveTofuPlanSchema,
  type ApproveTofuPlan,
} from "#shared/model/route-contract.ts";
import { PLAN_APPROVAL_STAGE_KEY } from "#shared/model/stage-keys.ts";
import { requireScope } from "#infrastructure/auth.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
  selectionFingerprint,
  wire,
} from "#infrastructure/delivery-records.ts";
import { id, type Transaction } from "#infrastructure/delivery-data.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { recordStageIn } from "#infrastructure/execution/stages.ts";

type DecisionRow = {
  id: string;
  status: string;
  pipelineRevisionId: string;
  versionSetRevisionId: string;
  configurationId: string;
};
type DecidedApproval = {
  id: string;
  status: string;
  actor: string | null;
  reason: string | null;
  overrideDecidedAt: Date | null;
};

/**
 * D6 and 4.13: a `tofu` recipe with an approve step takes its one approval
 * at the plan, bound to the plan digest. The environment's approval policy
 * is satisfied there, never by a selection approval.
 */
export function approvesAtPlan(definition: PipelineRevision["definition"]) {
  return (
    definition.kind === "tofu" &&
    "steps" in definition &&
    definition.steps.some((step) => step.kind === "approve")
  );
}

export async function recipeDefinition(
  tx: Transaction,
  pipelineRevisionId: string,
) {
  return PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: pipelineRevisionId } }),
        "Recipe",
      ),
    ),
  ).definition;
}

async function requireApproveStep(tx: Transaction, row: DecisionRow) {
  if (!approvesAtPlan(await recipeDefinition(tx, row.pipelineRevisionId)))
    throw new DeliveryError(
      "INVALID",
      "Only a model tofu recipe with an approve step takes a plan approval",
    );
}

/**
 * The approval a running deployment's plan decision fills: none yet, or the
 * pending override approval whose override was cleared before the plan ran
 * (H4). A decided approval is never decided again.
 */
function undecided(row: DecisionRow, approval: DecidedApproval | null) {
  if (row.status !== "running")
    throw new DeliveryError(
      "CONFLICT",
      "Only a running deployment's approve step takes a plan decision",
    );
  if (approval !== null && approval.overrideDecidedAt === null)
    throw new DeliveryError(
      "CONFLICT",
      "A running deployment's pending approval must have its override cleared",
    );
  return approval;
}

const approvalStatus = (input: ApproveTofuPlan) =>
  input.decision === "approved" ? "granted" : "rejected";

/**
 * One decision per deployment (4.13): repeating the identical decision on
 * the same plan returns the stage it settled; anything else conflicts.
 */
async function repeatedDecision(
  tx: Transaction,
  deploymentId: string,
  approval: DecidedApproval,
  decision: { input: ApproveTofuPlan; actor: Principal },
) {
  const settled = await tx.stage.findUnique({
    where: { deploymentId_key: { deploymentId, key: PLAN_APPROVAL_STAGE_KEY } },
  });
  if (
    settled?.operationId !== decision.input.planDigest ||
    approval.status !== approvalStatus(decision.input) ||
    approval.actor !== decision.actor.id ||
    approval.reason !== decision.input.reason
  )
    throw new DeliveryError(
      "CONFLICT",
      "This deployment's one approval has already been decided",
    );
  return wire(settled);
}

/**
 * The saved plan the decision names. Approval needs it unexpired;
 * rejecting an expired plan still ends the deployment without applying.
 */
async function namedPlan(
  tx: Transaction,
  deploymentId: string,
  input: ApproveTofuPlan,
) {
  const plan = TofuPlanReceiptSchema.parse(
    required(
      await tx.platformPlan.findUnique({ where: { deploymentId } }),
      "Saved plan of this deployment",
    ).receipt,
  );
  if (
    plan.planDigest !== input.planDigest ||
    (input.decision === "approved" && Date.parse(plan.expiresAt) <= Date.now())
  )
    throw new DeliveryError(
      "CONFLICT",
      "Approval must name this deployment's exact unexpired saved plan",
    );
  return plan;
}

/**
 * D6: a tofu approval binds the frozen selection, the plan digest, and the
 * state lineage and serial the plan was computed against.
 */
function planBinding(row: DecisionRow, plan: TofuPlanReceipt) {
  return fingerprint({
    selection: selectionFingerprint(
      row.versionSetRevisionId,
      row.pipelineRevisionId,
      row.configurationId,
    ),
    planDigest: plan.planDigest,
    state: plan.state,
  });
}

/**
 * The approve step of a model tofu recipe (section 5): a human's one
 * decision (4.13) on the exact saved plan this deployment produced. It
 * records the Approval with its approver and reason, bound to the plan, and
 * settles the stage the executor's approve step waits on. It satisfies the
 * environment's approval policy; a `required` policy creates no selection
 * approval for such a recipe, only an override does (H4). A rejection
 * (H3) discards the encrypted plan in the same transaction, so the
 * executor ends the deployment failed without applying.
 */
export async function approveTofuPlan(
  this: Delivery,
  deploymentId: string,
  raw: ApproveTofuPlan,
  actor: Principal,
) {
  requireScope(actor, "approve");
  const input = ApproveTofuPlanSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({
        where: { id: deploymentId },
        include: { approval: true },
      }),
      "Deployment",
    );
    await requireApproveStep(tx, row);
    if (row.approval !== null && row.approval.status !== "pending")
      return repeatedDecision(tx, deploymentId, row.approval, {
        input,
        actor,
      });
    const pending = undecided(row, row.approval);
    const plan = await namedPlan(tx, deploymentId, input);
    const rejected = input.decision === "rejected";
    const decision = {
      status: approvalStatus(input),
      actor: actor.id,
      reason: input.reason,
      decidedAt: new Date(),
      boundFingerprint: planBinding(row, plan),
    };
    await (pending === null
      ? tx.approval.create({ data: { id: id(), deploymentId, ...decision } })
      : tx.approval.update({ where: { id: pending.id }, data: decision }));
    const settled = await recordStageIn(
      tx,
      deploymentId,
      {
        key: PLAN_APPROVAL_STAGE_KEY,
        status: rejected ? "failed" : "succeeded",
        operationId: plan.planDigest,
        message: `${rejected ? "Rejected" : "Approved"} by ${actor.id}`,
        evidence: [
          {
            kind: "preflight",
            operationId: plan.planDigest,
            summary: JSON.stringify({
              adapter: "tofu-plan-approval",
              decision: input.decision,
              approver: actor.id,
              planDigest: plan.planDigest,
              state: plan.state,
              changes: plan.changes,
              reason: input.reason,
            }),
          },
        ],
      },
      // A human decision proves nothing about the executor's liveness, so it
      // never renews the executor's lease (D7).
      { actor, leaseSeconds: null },
    );
    if (rejected) await tx.platformPlan.delete({ where: { deploymentId } });
    await audit(tx, actor, {
      action: `platform.plan_${input.decision}`,
      entityId: deploymentId,
      requestId: id(),
      metadata: {
        planDigest: plan.planDigest,
        stack: plan.stack,
        discarded: rejected,
      },
    });
    return settled;
  });
}
