import { DeliveryError } from "#domain/error.ts";
import {
  DeploymentSchema,
  PipelineRevisionSchema,
  RequestTrmnlRepairSchema,
  type Principal,
  type RequestTrmnlRepair,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import { environment, id, version } from "#infrastructure/delivery-data.ts";
import {
  audit,
  lock,
  persistDeploymentRequest,
  replayDeployment,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { validateTrmnlSelection } from "#infrastructure/trmnl-policy.ts";

export async function requestTrmnlRepair(
  this: Delivery,
  sourceId: string,
  raw: RequestTrmnlRepair,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RequestTrmnlRepairSchema.parse(raw);
  const identity = { sourceId, ...input, kind: "repair-trmnl" };
  return this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input: identity,
      resultType: "deployment",
    });
    if (prior !== null) return replayDeployment(tx, prior.resultId);
    await lock(tx, "delivery:claim");
    await lock(tx, `deployment:${sourceId}`);
    const source = required(
      await tx.deployment.findUnique({ where: { id: sourceId } }),
      "Failed TRMNL deployment",
    );
    await lock(tx, `environment:${source.environmentId}`);
    const env = await environment(tx, source.environmentId);
    const pipeline = PipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: source.pipelineRevisionId },
          }),
          "Frozen pipeline",
        ),
      ),
    );
    validateTrmnlSelection(
      pipeline.definition,
      await version(tx, source.versionSetRevisionId),
    );
    if (
      env.serviceId !== "trmnl-dashboard" ||
      env.application !== "trmnl-dashboard" ||
      pipeline.definition.kind !== "argocd" ||
      pipeline.definition.trmnlPlugins === undefined
    )
      throw new DeliveryError(
        "INVALID",
        "Repair is limited to the fixed TRMNL dashboard plugin bundle",
      );
    const held = await tx.targetLock.findUnique({
      where: { instance: "application:trmnl-dashboard" },
    });
    if (
      !["failed", "canceled"].includes(source.status) ||
      !source.recoveryRequired ||
      env.activeDeploymentId !== source.id ||
      held?.deploymentId !== source.id ||
      env.generation !== input.expectedEnvironmentGeneration
    )
      throw new DeliveryError(
        "CONFLICT",
        "Repair requires the exact quarantined failed deployment, held target and current environment generation",
      );
    if (
      (await tx.deployment.findFirst({
        where: {
          environmentId: env.id,
          status: { in: ["queued", "running", "awaiting_approval"] },
        },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Environment already has a pending repair or deployment",
      );
    const row = await tx.deployment.create({
      data: {
        id: id(),
        requestId: input.requestId,
        repairOfDeploymentId: source.id,
        environmentId: env.id,
        serviceId: source.serviceId,
        versionSetRevisionId: source.versionSetRevisionId,
        previousAcceptedVersionSetRevisionId:
          source.previousAcceptedVersionSetRevisionId,
        previousAcceptedDeploymentId: source.previousAcceptedDeploymentId,
        pipelineRevisionId: source.pipelineRevisionId,
        configurationId: source.configurationId,
        catalogRevision: source.catalogRevision,
        expectedGeneration: env.generation,
        kind: "repair-trmnl",
        status: "queued",
        automatic: false,
        requestedBy: actor.id,
        message: input.reason,
      },
    });
    await persistDeploymentRequest(tx, actor, {
      deployment: row,
      requestId: input.requestId,
      input: identity,
    });
    await audit(tx, actor, {
      action: "trmnl.repair_requested",
      entityId: row.id,
      requestId: input.requestId,
      metadata: { sourceId, reason: input.reason },
    });
    return DeploymentSchema.parse(wire(row));
  });
}
