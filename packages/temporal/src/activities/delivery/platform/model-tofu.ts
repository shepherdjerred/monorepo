import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod";
import {
  RecordTofuPlanSchema,
  type DeploymentDetail,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { PLAN_APPROVAL_STAGE_KEY } from "@shepherdjerred/delivery/model-contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import {
  modelSteps,
  requireModelRecipe,
  requireStep,
  type TofuRecipe,
} from "#lib/delivery/model/recipe.ts";
import {
  modelApplyInput,
  modelPlanInput,
  modelTofuJobRequest,
  modelTofuSource,
} from "#lib/delivery/model/tofu.ts";
import { platformNativeEvidence } from "#lib/delivery/platform/native-job.ts";
import { TofuStateMarkerSchema } from "#lib/delivery/platform/tofu-input.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import type { DeliveryJobReceipt } from "#shared/delivery-job.ts";
import {
  recordStage,
  requireOwned,
  stageOf,
} from "#activities/delivery/model/stages.ts";
import {
  stepLease,
  withLeaseRenewal,
} from "#activities/delivery/model/lease.ts";

type Step = { current: DeploymentDetail; recipe: TofuRecipe; key: string };

/** Runs one Tofu Job, recording its native identity as the step's intent first. */
async function runTofuJob(
  step: Step,
  input: { recipe: "tofu-plan" | "tofu-apply"; jobInput: unknown },
  runJob: typeof runDeliveryJob,
) {
  const request = modelTofuJobRequest(step.current, {
    recipe: step.recipe,
    key: step.key,
    kind: input.recipe,
    jobInput: input.jobInput,
  });
  const operationId = z
    .string()
    .parse(deliveryJobManifest(request).metadata?.name);
  let receipt: DeliveryJobReceipt | undefined;
  const result = await runJob(request, async (native) => {
    receipt = native;
    await recordStage(step.current, step.key, "running", {
      operationId,
      message: JSON.stringify(native),
      evidence: platformNativeEvidence(native),
    });
  });
  if (receipt === undefined)
    throw new Error("Tofu Job has no persisted native receipt");
  return { result, receipt, operationId };
}

async function plan(step: Step, runJob: typeof runDeliveryJob) {
  const { result, receipt, operationId } = await runTofuJob(
    step,
    {
      recipe: "tofu-plan",
      jobInput: modelPlanInput(step.current, step.recipe),
    },
    runJob,
  );
  const saved = RecordTofuPlanSchema.parse(result);
  const source = modelTofuSource(step.current, step.recipe);
  if (
    canonicalJson(saved.receipt.nativeJob) !== canonicalJson(receipt) ||
    saved.receipt.deploymentId !== step.current.deployment.id ||
    saved.receipt.sourceBuildId !== source.sourceBuildId ||
    saved.receipt.sourceRevision !== source.sourceRevision ||
    saved.receipt.stack !== step.recipe.stack
  )
    throw new Error(
      "Saved plan differs from its frozen stack archive or actual native Job",
    );
  await deliveryRequest("platform/plans", z.unknown(), saved);
  await recordStage(step.current, step.key, "succeeded", {
    operationId,
    message: JSON.stringify(receipt),
    evidence: [
      ...platformNativeEvidence(receipt),
      {
        kind: "preflight",
        operationId: receipt.uid,
        summary: JSON.stringify({
          adapter: "tofu",
          step: "plan",
          stack: step.recipe.stack,
          planDigest: saved.receipt.planDigest,
          changes: saved.receipt.changes,
        }),
      },
    ],
  });
}

/**
 * A saved plan nobody decided before it expired can never be applied, so the
 * approve step settles failed instead of waiting while it holds the stack
 * and platform locks. Delivery expires the undecided approval when the
 * failed deployment finishes.
 */
async function requireUnexpiredPlan(step: Step, operationId: string) {
  const stored = await deliveryRequest(
    `platform/plans/${encodeURIComponent(step.current.deployment.id)}`,
    RecordTofuPlanSchema,
  );
  if (Date.parse(stored.receipt.expiresAt) > Date.now()) return;
  const reason = `Saved plan ${stored.receipt.planDigest} expired at ${stored.receipt.expiresAt} before a decision; nothing was applied`;
  await recordStage(step.current, step.key, "failed", {
    operationId,
    message: reason,
    evidence: [
      {
        kind: "preflight",
        operationId: stored.receipt.planDigest,
        summary: reason,
      },
    ],
  });
  throw ApplicationFailure.nonRetryable(reason, "DeliveryPlanExpired");
}

/**
 * The approve step waits for a human's one decision on the exact saved plan
 * (4.13), but never past the plan's expiry. A rejection (H3) settles the
 * step failed, so no stage stays running and the failed deployment releases
 * its locks; the plan was discarded with the decision and is never applied.
 */
async function approve(step: Step): Promise<{ waiting: boolean }> {
  const operationId = deliveryOperationId(step.current.deployment.id);
  const approval = stageOf(step.current, PLAN_APPROVAL_STAGE_KEY);
  if (approval?.status === "failed") {
    await recordStage(step.current, step.key, "failed", {
      operationId,
      message: `Saved plan ${approval.operationId} rejected: ${approval.message}`,
      evidence: [
        {
          kind: "preflight",
          operationId: approval.operationId,
          summary: `Saved plan ${approval.operationId} rejected: ${approval.message}`,
        },
      ],
    });
    throw ApplicationFailure.nonRetryable(
      `Saved plan ${approval.operationId} was rejected; nothing was applied`,
      "DeliveryPlanRejected",
    );
  }
  if (approval?.status !== "succeeded") {
    await requireUnexpiredPlan(step, operationId);
    if (stageOf(step.current, step.key) === undefined)
      await recordStage(step.current, step.key, "running", { operationId });
    return { waiting: true };
  }
  await recordStage(step.current, step.key, "succeeded", {
    operationId,
    evidence: [
      {
        kind: "preflight",
        operationId: approval.operationId,
        summary: `Saved plan ${approval.operationId} approved: ${approval.message}`,
      },
    ],
  });
  return { waiting: false };
}

async function apply(step: Step, runJob: typeof runDeliveryJob) {
  const id = step.current.deployment.id;
  const stored = await deliveryRequest(
    `platform/plans/${encodeURIComponent(id)}`,
    RecordTofuPlanSchema,
  );
  if (Date.parse(stored.receipt.expiresAt) <= Date.now())
    throw new Error(
      "Saved plan expired before apply; request a new deployment",
    );
  const { result, receipt, operationId } = await runTofuJob(
    step,
    {
      recipe: "tofu-apply",
      jobInput: modelApplyInput(step.current, step.recipe, stored.receipt),
    },
    runJob,
  );
  const applied = z
    .object({
      stack: z.literal(step.recipe.stack),
      planDeploymentId: z.literal(id),
      planDigest: z.literal(stored.receipt.planDigest),
      outcome: z.literal("applied-saved-plan"),
      state: z.object({
        lineage: z.literal(stored.receipt.state.lineage),
        serial: z.number().int().min(stored.receipt.state.serial),
      }),
      marker: TofuStateMarkerSchema.refine(
        (marker) =>
          marker.deploymentId === id && marker.stack === step.recipe.stack,
        "State marker names another deployment or stack",
      ),
    })
    .strict()
    .parse(result);
  const evidence: EvidenceInput[] = [
    ...platformNativeEvidence(receipt),
    {
      kind: "reconciliation",
      operationId: receipt.uid,
      summary: JSON.stringify({
        adapter: "tofu",
        step: "apply",
        stack: step.recipe.stack,
        planDigest: applied.planDigest,
        stateSerial: applied.marker.stateSerial,
      }),
    },
  ];
  await recordStage(step.current, step.key, "succeeded", {
    operationId,
    message: JSON.stringify(receipt),
    evidence,
  });
}

/**
 * A model tofu recipe's step on the platform queue, the only one holding
 * platform authority: plan from the frozen stack archive, wait for the
 * approval of the exact saved plan, apply it (section 5, X8, T5).
 */
export async function runDeliveryModelPlatformStep(
  id: string,
  key: string,
  runJob: typeof runDeliveryJob = runDeliveryJob,
): Promise<{ waiting: boolean }> {
  const current = await requireOwned(id);
  if (stageOf(current, key)?.status === "succeeded") return { waiting: false };
  const recipe = requireModelRecipe(current);
  const step = requireStep(modelSteps(recipe), key);
  if (recipe.kind !== "tofu" || step.adapter !== "tofu")
    throw new Error(`Step ${key} is not a Tofu step of a tofu recipe`);
  const frozen = { current, recipe, key };
  // A Tofu Job can outlast the lease; it is renewed while the step runs.
  return await withLeaseRenewal(stepLease(current), async () => {
    switch (step.kind) {
      case "plan":
        await plan(frozen, runJob);
        return { waiting: false };
      case "approve":
        return await approve(frozen);
      case "apply":
        await apply(frozen, runJob);
        return { waiting: false };
    }
  });
}
