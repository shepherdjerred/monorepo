import { beginDeploymentRequest } from "#infrastructure/deployment-request-store.ts";
import { persistDeploymentRequest } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  DeploymentSchema,
  CreateDeploymentSchema,
  deliveryWorkflowId,
} from "#shared/contract.ts";
import type { CreateDeployment, Principal } from "#shared/contract.ts";
import {
  ApprovalV2InputSchema,
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
  version,
  environment,
  ensureService,
  requestApproval,
  validateSelection,
} from "./delivery-data.ts";
import { deploymentSelection } from "./delivery-request-selection.ts";
import {
  freezeWorkerDeployment,
  requireWorkerAdmission,
} from "./worker-pool/baseline.ts";
import { requireScope } from "./auth.ts";
import { validateScoutSiteSelection } from "./scout-site-policy.ts";
import { validateTrmnlSelection } from "./trmnl-policy.ts";
import { verifyForumCandidateSource } from "./forum/source-policy.ts";
import {
  freezeForumBaseline,
  validateForumCandidate,
} from "./forum/freezer.ts";
import { freezeRecoveredForumRuntime } from "./forum/recovered-runtime.ts";

export async function createDeployment(
  this: Delivery,
  rawInput: CreateDeployment,
  actor: Principal,
  automatic = false,
) {
  const input = CreateDeploymentSchema.parse(rawInput);
  if (input.kind === "adopt-worker") requireScope(actor, "admin");
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
  await verifyForumCandidateSource.call(this, input, this.forumPolicyReader);
  return this.database.$transaction(async (tx) => {
    const selection = await beginDeploymentRequest(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      environmentId: input.environmentId,
    });
    if (selection.kind === "replayed") return selection.deployment;
    const env = selection.environment;
    const service = await ensureService(tx, env.serviceId);
    if (env.lifecycle !== "active")
      throw new DeliveryError(
        "INVALID",
        `Environment ${env.id} is ${env.lifecycle} and admits no deployment`,
      );
    const selectedInputs = await deploymentSelection(tx, input, env);
    const { pipeline } = selectedInputs;
    if (
      pipeline.definition.kind === "root-release" ||
      pipeline.definition.kind === "tofu" ||
      pipeline.definition.kind === "control-plane"
    )
      throw new DeliveryError(
        "INVALID",
        "Specialized control-plane and platform pipelines require their exact typed source, artifact, inventory or saved-plan request",
      );
    const selected = await version(tx, input.versionSetRevisionId);
    if (selected.serviceId !== env.serviceId)
      throw new DeliveryError(
        "INVALID",
        "Version set belongs to another service",
      );
    validateScoutSiteSelection(pipeline.definition, selected);
    validateTrmnlSelection(pipeline.definition, selected);
    await requireWorkerAdmission(tx, env, pipeline.definition, input.kind);
    if (env.generation !== input.expectedGeneration)
      throw new DeliveryError(
        "CONFLICT",
        "Environment generation changed; inspect current state before retrying",
      );
    if (env.activeDeploymentId !== null)
      throw new DeliveryError(
        "CONFLICT",
        "Environment already has an active deployment",
      );
    const pending = await tx.deployment.findFirst({
      where: {
        environmentId: env.id,
        status: { in: ["queued", "awaiting_approval"] },
      },
    });
    if (pending !== null)
      throw new DeliveryError(
        "CONFLICT",
        "Environment already has a pending deployment; cancel it before selecting another revision",
      );
    await validateSelection(tx, input, env, selected);
    const previousAccepted =
      env.acceptedDeploymentId === null
        ? null
        : required(
            await tx.deployment.findUnique({
              where: { id: env.acceptedDeploymentId },
            }),
            "Accepted deployment snapshot",
          );
    validateForumCandidate(
      pipeline,
      selected,
      selectedInputs.configuration.content,
    );
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
      restored: selectedInputs.restoredWorkerSnapshot,
      baseline: input.workerBaseline,
      repositoryId: this.repositoryId,
    });
    const approvalRequired = env.approvalPolicy === "required";
    const row = await tx.deployment.create({
      data: {
        id: deploymentId,
        requestId: input.requestId,
        environmentId: env.id,
        serviceId: env.serviceId,
        versionSetRevisionId: selected.id,
        previousAcceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
        previousAcceptedDeploymentId: env.acceptedDeploymentId,
        restoredDeploymentId: selectedInputs.restoredDeploymentId,
        pipelineRevisionId: pipeline.id,
        configurationId: selectedInputs.configuration.id,
        catalogRevision: service.catalogRevision,
        ...(workerSnapshot === null ? {} : { workerSnapshot }),
        ...(forumBaselineSnapshot === null ? {} : { forumBaselineSnapshot }),
        sourceEnvironmentId: input.sourceEnvironmentId ?? null,
        expectedGeneration: env.generation,
        kind: input.kind,
        automatic,
        status: approvalRequired ? "awaiting_approval" : "queued",
        requestedBy: actor.id,
      },
    });
    // The approval row exists from the request on, bound to the frozen
    // selection, and is decided by a distinct human act (model H1, D6).
    if (approvalRequired) await requestApproval(tx, row);
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
        ...(forumRecoveredRuntime === null ? {} : { forumRecoveredRuntime }),
      },
    });
    return DeploymentSchema.parse(wire(row));
  });
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
    const approval = row.approval;
    if (approval === null)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment requires no approval under its environment's policy",
      );
    const status = input.decision === "approve" ? "granted" : "rejected";
    if (approval.status !== "pending") {
      if (
        approval.status !== status ||
        approval.actor !== actor.id ||
        approval.reason !== input.reason ||
        approval.override !== input.override
      )
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
      data: {
        status,
        actor: actor.id,
        reason: input.reason,
        override: input.override,
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
      metadata: { override: input.override },
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
