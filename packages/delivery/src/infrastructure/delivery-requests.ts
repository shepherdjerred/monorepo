import { beginDeploymentRequest } from "#infrastructure/deployment-request-store.ts";
import { persistDeploymentRequest } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { DeploymentSchema, deliveryWorkflowId } from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import type { Approval } from "#generated/prisma/client.ts";
import {
  ApprovalV2InputSchema,
  type ApprovalV2Input,
  type ApprovalV2Request,
} from "#shared/model/approval-contract.ts";
import {
  wire,
  lock,
  required,
  audit,
  request,
  selectionFingerprint,
} from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  terminal,
  id,
  environment,
  ensureService,
  requestApproval,
} from "./delivery-data.ts";
import {
  requireKindForRecipe,
  selectDeployment,
} from "./selection/selection.ts";
import {
  adoptionSelection,
  candidateSetRevision,
  type DeploymentRequest,
  type ParsedRequest,
  parseDeploymentRequest,
  refuseLegacyPlatform,
  requireEligibleOrOverride,
  requireIdleEnvironment,
  restoredWorkerSnapshot,
} from "./selection/request.ts";
import {
  freezeWorkerDeployment,
  requireWorkerAdmission,
} from "./worker-pool/baseline.ts";
import { requireScope } from "./auth.ts";
import { approvesAtPlan, recipeDefinition } from "./platform/plan-decision.ts";
import { validateScoutSiteSelection } from "./scout-site-policy.ts";
import { validateTrmnlSelection } from "./trmnl-policy.ts";
import { verifyForumCandidateSource } from "./forum/source-policy.ts";
import {
  freezeForumBaseline,
  validateForumCandidate,
} from "./forum/freezer.ts";
import { freezeRecoveredForumRuntime } from "./forum/recovered-runtime.ts";

/**
 * Whether the request waits for an approval of its selection. A recipe that
 * approves its tofu plan meets the policy at the plan instead (D6); only an
 * override is approved with its selection (H4).
 */
function selectionApprovalRequired(
  policy: string,
  definition: Parameters<typeof approvesAtPlan>[0],
  override: boolean,
) {
  return override || (policy === "required" && !approvesAtPlan(definition));
}

/**
 * Request one deployment of an environment: freeze its selection, check
 * eligibility and the binding generation (E2), and record the request,
 * audit and outbox together (D1).
 */
export async function createDeployment(
  this: Delivery,
  rawInput: DeploymentRequest,
  actor: Principal,
  automatic = false,
) {
  const parsed = parseDeploymentRequest(rawInput);
  const input: ParsedRequest = parsed.adoption ?? parsed.model;
  if (parsed.adoption !== null) requireScope(actor, "admin");
  const requestInput = { ...input, automatic };
  if (
    (await this.database.request.findUnique({
      where: { id: input.requestId },
    })) !== null
  )
    return this.database.$transaction(async (tx) => {
      const previous = required(
        await request(tx, actor, {
          requestId: input.requestId,
          input: requestInput,
          resultType: "deployment",
        }),
        "Existing deployment request",
      );
      return DeploymentSchema.parse(
        wire(
          required(
            await tx.deployment.findUnique({
              where: { id: previous.resultId },
            }),
            "Requested deployment",
          ),
        ),
      );
    });
  const candidate = await candidateSetRevision.call(this, input);
  if (candidate !== undefined)
    await verifyForumCandidateSource.call(
      this,
      {
        kind: input.kind,
        environmentId: input.environmentId,
        versionSetRevisionId: candidate,
      },
      this.forumPolicyReader,
    );
  return this.database.$transaction(async (tx) => {
    const begun = await beginDeploymentRequest(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      environmentId: input.environmentId,
    });
    if (begun.kind === "replayed") return begun.deployment;
    const env = begun.environment;
    const service = await ensureService(tx, env.serviceId);
    if (env.lifecycle !== "active")
      throw new DeliveryError(
        "INVALID",
        `Environment ${env.id} is ${env.lifecycle} and admits no deployment`,
      );
    const selection =
      parsed.adoption === null
        ? await selectDeployment(tx, parsed.model, env)
        : await adoptionSelection(tx, parsed.adoption, env);
    if (parsed.model !== null)
      requireKindForRecipe(parsed.model.kind, selection.pipeline);
    refuseLegacyPlatform(selection);
    const override = requireEligibleOrOverride(input, selection);
    const { pipeline, versionSet: selected, configuration } = selection;
    // A rollback restores its selection exactly, even one composed for the
    // service an environment had before a catalog rename (R5).
    if (input.kind !== "rollback" && selected.serviceId !== env.serviceId)
      throw new DeliveryError(
        "INVALID",
        "Version set belongs to another service",
      );
    validateScoutSiteSelection(pipeline.definition, selected);
    validateTrmnlSelection(pipeline.definition, selected);
    await requireWorkerAdmission(tx, env, pipeline.definition, input.kind);
    await requireIdleEnvironment(tx, env, input.expectedGeneration);
    const previousAccepted =
      env.acceptedDeploymentId === null
        ? null
        : required(
            await tx.deployment.findUnique({
              where: { id: env.acceptedDeploymentId },
            }),
            "Accepted deployment snapshot",
          );
    validateForumCandidate(pipeline, selected, configuration.content);
    const forumRecoveredRuntime = await freezeRecoveredForumRuntime(tx, {
      environmentId: env.id,
      pipeline,
      acceptedAt: previousAccepted?.finishedAt ?? null,
    });
    const forumBaselineSnapshot = await freezeForumBaseline(tx, {
      environment: env,
      pipeline,
      recoveredRuntime: forumRecoveredRuntime !== null,
    });
    const deploymentId = id();
    const workerSnapshot = await freezeWorkerDeployment(tx, {
      environment: env,
      pipeline,
      versionSet: selected,
      deploymentId,
      restored: await restoredWorkerSnapshot(
        tx,
        selection.restoredDeploymentId,
      ),
      baseline: parsed.adoption?.workerBaseline,
      repositoryId: this.repositoryId,
    });
    const approvalRequired = selectionApprovalRequired(
      env.approvalPolicy,
      pipeline.definition,
      override,
    );
    const row = await tx.deployment.create({
      data: {
        id: deploymentId,
        requestId: input.requestId,
        environmentId: env.id,
        serviceId: env.serviceId,
        versionSetRevisionId: selected.id,
        previousAcceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
        previousAcceptedDeploymentId: env.acceptedDeploymentId,
        restoredDeploymentId: selection.restoredDeploymentId,
        pipelineRevisionId: pipeline.id,
        configurationId: configuration.id,
        catalogRevision: service.catalogRevision,
        ...(workerSnapshot === null ? {} : { workerSnapshot }),
        ...(forumBaselineSnapshot === null ? {} : { forumBaselineSnapshot }),
        sourceEnvironmentId: selection.sourceEnvironmentId,
        expectedGeneration: env.generation,
        kind: input.kind,
        automatic,
        status: approvalRequired ? "awaiting_approval" : "queued",
        requestedBy: actor.id,
        ...("message" in input && input.message !== undefined
          ? { message: input.message }
          : {}),
      },
    });
    if (approvalRequired) await requestApproval(tx, row, { override });
    await persistDeploymentRequest(tx, actor, {
      deployment: row,
      requestId: input.requestId,
      input: requestInput,
    });
    await audit(tx, actor, {
      action: "deployment.requested",
      entityId: row.id,
      requestId: input.requestId,
      metadata: {
        versionSetRevisionId: selected.id,
        environmentId: env.id,
        catalogRevision: service.catalogRevision,
        ...(selection.ineligible.length === 0
          ? {}
          : { override: selection.ineligible }),
        ...(forumRecoveredRuntime === null ? {} : { forumRecoveredRuntime }),
      },
    });
    return DeploymentSchema.parse(wire(row));
  });
}

const decidedStatus = (input: ApprovalV2Input) =>
  input.decision === "approve" ? "granted" : "rejected";

/** The approval a decision names; an override is decided as one, an ordinary one never is (H4). */
function decidableApproval(
  approval: Approval | null,
  input: ApprovalV2Input,
  atPlan: boolean,
) {
  if (approval === null)
    throw new DeliveryError(
      "CONFLICT",
      atPlan
        ? "This deployment's one approval is its plan decision at the approve step"
        : "Deployment requires no approval under its environment's policy",
    );
  if (approval.override !== input.override)
    throw new DeliveryError(
      "INVALID",
      approval.override
        ? "This non-eligible deploy needs an approval marked override"
        : "Only a non-eligible deploy takes an override approval",
    );
  return approval;
}

/** Only the identical decision repeats; a cleared override repeats as one. */
function repeats(
  approval: Approval,
  input: ApprovalV2Input,
  decision: { actor: string; overrideOnly: boolean },
) {
  return decision.overrideOnly
    ? approval.overrideActor === decision.actor &&
        approval.overrideReason === input.reason
    : approval.status === decidedStatus(input) &&
        approval.actor === decision.actor &&
        approval.reason === input.reason;
}

export async function approve(
  this: Delivery,
  deploymentId: string,
  rawInput: ApprovalV2Request,
  actor: Principal,
) {
  const input = ApprovalV2InputSchema.parse(rawInput);
  if (actor.kind !== "human")
    throw new DeliveryError(
      "FORBIDDEN",
      "Only authenticated human operators can approve production releases",
    );
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({
        where: { id: deploymentId },
        include: { approval: true },
      }),
      "Deployment",
    );
    const atPlan = approvesAtPlan(
      await recipeDefinition(tx, row.pipelineRevisionId),
    );
    const approval = decidableApproval(row.approval, input, atPlan);
    // A recipe that approves its plan clears only the override here; its
    // one decision waits for the plan (D6, H4).
    const overrideOnly = atPlan && input.decision === "approve";
    if (approval.status !== "pending" || approval.overrideDecidedAt !== null) {
      if (!repeats(approval, input, { actor: actor.id, overrideOnly }))
        throw new DeliveryError(
          "CONFLICT",
          "Approval has already been decided",
        );
      return DeploymentSchema.parse(wire(row));
    }
    if (row.status !== "awaiting_approval")
      throw new DeliveryError(
        "CONFLICT",
        "Deployment is not awaiting approval",
      );
    const env = await environment(tx, row.environmentId);
    const now = new Date();
    if (env.generation !== row.expectedGeneration) {
      // The binding generation moved on, so the frozen selection can no
      // longer be approved: the approval expires and the request fails (H2).
      await tx.approval.update({
        where: { id: approval.id },
        data: { status: "expired", decidedAt: now },
      });
      const failed = await tx.deployment.update({
        where: { id: deploymentId },
        data: {
          status: "failed",
          message:
            "Deployment inputs changed before approval; the approval expired",
          finishedAt: now,
        },
      });
      await audit(tx, actor, {
        action: "deployment.approval_expired",
        entityId: deploymentId,
        requestId: id(),
      });
      return DeploymentSchema.parse(wire(failed));
    }
    if (
      approval.boundFingerprint !==
      selectionFingerprint(
        row.versionSetRevisionId,
        row.pipelineRevisionId,
        row.configurationId,
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Approval is bound to a different frozen selection",
      );
    await tx.approval.update({
      where: { id: approval.id },
      data: overrideOnly
        ? {
            overrideActor: actor.id,
            overrideReason: input.reason,
            overrideDecidedAt: now,
          }
        : {
            status: decidedStatus(input),
            actor: actor.id,
            reason: input.reason,
            decidedAt: now,
          },
    });
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: input.decision === "approve" ? "queued" : "canceled",
        message: input.reason,
        ...(input.decision === "reject" ? { finishedAt: now } : {}),
      },
    });
    if (input.decision === "approve")
      await tx.outbox.create({
        data: { deploymentId, workflowId: deliveryWorkflowId(deploymentId) },
      });
    await audit(tx, actor, {
      action: `deployment.${input.decision}`,
      entityId: deploymentId,
      requestId: id(),
      metadata: { override: input.override, decidedAtPlan: atPlan },
    });
    return DeploymentSchema.parse(wire(updated));
  });
}

export async function cancel(
  this: Delivery,
  deploymentId: string,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    if (terminal.has(row.status)) return DeploymentSchema.parse(wire(row));
    const running = row.status === "running";
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        cancelRequested: true,
        ...(running
          ? {}
          : {
              status: "canceled",
              finishedAt: new Date(),
              message: "Canceled before execution",
            }),
      },
    });
    if (!running) await tx.outbox.deleteMany({ where: { deploymentId } });
    await audit(tx, actor, {
      action: "deployment.cancel_requested",
      entityId: deploymentId,
      requestId: id(),
    });
    return DeploymentSchema.parse(wire(updated));
  });
}
