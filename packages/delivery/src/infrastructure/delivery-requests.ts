import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { DeploymentSchema, deliveryWorkflowId } from "#shared/contract.ts";
import type { CreateDeployment, Principal } from "#shared/contract.ts";
import {
  wire,
  lock,
  required,
  audit,
  request,
  remember,
} from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  terminal,
  id,
  version,
  environment,
  validateSelection,
  approvalRequired,
} from "./delivery-data.ts";
import { deploymentSelection } from "./delivery-request-selection.ts";

export async function createDeployment(
  this: Delivery,
  input: CreateDeployment,
  actor: Principal,
  automatic = false,
) {
  const requestInput = { ...input, automatic };
  return this.database.$transaction(async (tx) => {
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "deployment",
    });
    if (previous !== null)
      return DeploymentSchema.parse(
        wire(
          required(
            await tx.deployment.findUnique({
              where: { id: previous.resultId },
            }),
            "Deployment",
          ),
        ),
      );
    await lock(tx, `environment:${input.environmentId}`);
    const env = await environment(tx, input.environmentId);
    const selectedInputs = await deploymentSelection(tx, input, env);
    const { pipeline } = selectedInputs;
    if (
      pipeline.definition.kind === "argocd" &&
      pipeline.definition.workerRollout !== undefined
    )
      throw new DeliveryError(
        "INVALID",
        "Worker rollout activation requires retained-version host management; keep the existing deployment owner",
      );
    const selected = await version(tx, input.versionSetRevisionId);
    if (selected.serviceId !== env.serviceId)
      throw new DeliveryError(
        "INVALID",
        "Version set belongs to another service",
      );
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
      env.acceptedVersionSetRevisionId === null
        ? null
        : required(
            await tx.deployment.findFirst({
              where: {
                environmentId: env.id,
                versionSetRevisionId: env.acceptedVersionSetRevisionId,
                status: "succeeded",
              },
              orderBy: { finishedAt: "desc" },
            }),
            "Accepted deployment snapshot",
          );
    if (
      previousAccepted === null &&
      pipeline.definition.kind === "argocd" &&
      pipeline.definition.forumRelease !== undefined
    )
      throw new DeliveryError(
        "INVALID",
        "Forum upgrade requires a verified accepted baseline and frozen prior configuration; keep the existing owner until baseline verification",
      );
    const previousConfiguration =
      previousAccepted === null
        ? null
        : z
            .record(z.string(), z.string())
            .parse(previousAccepted.configuration);
    const row = await tx.deployment.create({
      data: {
        id: id(),
        requestId: input.requestId,
        environmentId: env.id,
        serviceId: env.serviceId,
        versionSetRevisionId: selected.id,
        previousAcceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
        ...(previousConfiguration === null
          ? {}
          : { previousAcceptedConfiguration: previousConfiguration }),
        pipelineRevisionId: pipeline.id,
        configurationRevision: selectedInputs.configurationRevision,
        configuration: selectedInputs.configuration,
        sourceEnvironmentId: input.sourceEnvironmentId ?? null,
        expectedGeneration: env.generation,
        kind: input.kind,
        automatic,
        status:
          env.approvalRequired ||
          approvalRequired(env.serviceId, {
            application: env.application,
            name: env.name,
            pipeline: pipeline.definition,
          })
            ? "awaiting_approval"
            : "queued",
        requestedBy: actor.id,
      },
    });
    if (row.status === "queued")
      await tx.outbox.create({
        data: { deploymentId: row.id, workflowId: deliveryWorkflowId(row.id) },
      });
    await remember(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "deployment",
      resultId: row.id,
    });
    await audit(tx, actor, {
      action: "deployment.requested",
      entityId: row.id,
      requestId: input.requestId,
      metadata: { versionSetRevisionId: selected.id, environmentId: env.id },
    });
    return DeploymentSchema.parse(wire(row));
  });
}

export async function approve(
  this: Delivery,
  ...args: [
    deploymentId: string,
    decision: "approve" | "reject",
    reason: string,
    actor: Principal,
  ]
) {
  const [deploymentId, decision, reason, actor] = args;
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
        include: { approvals: true },
      }),
      "Deployment",
    );
    const prior = row.approvals[0];
    if (prior !== undefined) {
      if (
        prior.decision !== decision ||
        prior.actor !== actor.id ||
        prior.reason !== reason
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
    if (env.generation !== row.expectedGeneration)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment inputs changed; request a new deployment",
      );
    await tx.approval.create({
      data: { id: id(), deploymentId, decision, reason, actor: actor.id },
    });
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: decision === "approve" ? "queued" : "canceled",
        message: reason,
        ...(decision === "reject" ? { finishedAt: new Date() } : {}),
      },
    });
    if (decision === "approve")
      await tx.outbox.create({
        data: { deploymentId, workflowId: deliveryWorkflowId(deploymentId) },
      });
    await audit(tx, actor, {
      action: `deployment.${decision}`,
      entityId: deploymentId,
      requestId: id(),
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
