import {
  replayDeployment,
  persistDeploymentRequest,
} from "#infrastructure/delivery-records.ts";
import {
  ControlPlaneUpgradeSnapshotSchema,
  DeploymentSchema,
  PipelineRevisionSchema,
  RequestControlPlaneUpgradeSchema,
  type RequestControlPlaneUpgrade,
  type Principal,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  lock,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { id } from "#infrastructure/delivery-data.ts";
import { requireIdleWorkerEnvironment } from "#infrastructure/worker-pool/registration.ts";
import {
  controlPlaneArtifact,
  controlPlaneEnvironment,
  previousControlPlane,
  requireControlPlaneCompatibility,
  requireControlPlaneOwner,
  validateControlPlaneEnvironment,
} from "./policy.ts";

export async function requestControlPlaneUpgrade(
  this: Delivery,
  environmentId: string,
  raw: RequestControlPlaneUpgrade,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RequestControlPlaneUpgradeSchema.parse(raw);
  const requestInput = { environmentId, ...input };
  return this.database.$transaction(async (tx) => {
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "deployment",
    });
    if (previous !== null) return replayDeployment(tx, previous.resultId);
    if (environmentId !== controlPlaneEnvironment)
      throw new DeliveryError(
        "INVALID",
        "Explicit controller upgrades target only the independent control-plane environment",
      );
    requireControlPlaneOwner(this.catalog);
    await lock(tx, `environment:${environmentId}`);
    const env = await requireIdleWorkerEnvironment(tx, {
      environmentId,
      expectedGeneration: input.expectedGeneration,
    });
    const pipeline = PipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: env.pipelineRevisionId },
          }),
          "Control-plane pipeline",
        ),
      ),
    );
    if (pipeline.definition.kind !== "control-plane")
      throw new DeliveryError(
        "INVALID",
        "Controller upgrade requires its fixed independent pipeline",
      );
    validateControlPlaneEnvironment(
      {
        ...env,
        application: env.application ?? undefined,
        promotionSourceEnvironmentId:
          env.promotionSourceEnvironmentId ?? undefined,
      },
      pipeline.definition,
    );
    const next = await controlPlaneArtifact(
      tx,
      input.imageArtifactId,
      "image",
      this.repositoryId,
    );
    const chart = await controlPlaneArtifact(
      tx,
      input.chartArtifactId,
      "chart",
      this.repositoryId,
    );
    requireControlPlaneCompatibility(next.artifact, chart.artifact);
    const prior = await previousControlPlane(tx, {
      acceptedDeploymentId: env.acceptedControlPlaneDeploymentId,
      repositoryId: this.repositoryId,
      ...(input.previousImageArtifactId === undefined
        ? {}
        : { previousImageArtifactId: input.previousImageArtifactId }),
      ...(input.priorChartArtifactId === undefined
        ? {}
        : { priorChartArtifactId: input.priorChartArtifactId }),
    });
    const snapshot = ControlPlaneUpgradeSnapshotSchema.parse({
      schema: "delivery-control-plane/v1",
      source: chart.source,
      ...prior,
      nextArtifact: next.artifact,
      chartArtifact: chart.artifact,
    });
    const anchor = required(
      await tx.versionSet.findFirst({
        where: {
          serviceId: env.serviceId,
          qualifiedBuildId: { not: null },
          entries: { some: { artifactId: chart.artifact.id } },
        },
        orderBy: { revision: "desc" },
      }),
      "Original qualified controller chart version",
    );
    const deployment = await tx.deployment.create({
      data: {
        id: id(),
        requestId: input.requestId,
        environmentId: env.id,
        serviceId: env.serviceId,
        versionSetRevisionId: anchor.id,
        pipelineRevisionId: pipeline.id,
        configurationRevision: env.configurationRevision,
        configuration: env.configuration,
        expectedGeneration: env.generation,
        kind: "upgrade-control-plane",
        requestedBy: actor.id,
        status: "queued",
        message: input.reason,
        controlPlaneSnapshot: snapshot,
      },
    });
    await tx.platformArtifactReference.createMany({
      data: [
        {
          kind: "control-plane-previous",
          selector: "image",
          artifactId: prior.previousArtifact.id,
        },
        {
          kind: "control-plane-next",
          selector: "image",
          artifactId: next.artifact.id,
        },
        {
          kind: "control-plane-chart",
          selector: "prior",
          artifactId: prior.priorChartArtifact.id,
        },
        {
          kind: "control-plane-chart",
          selector: "next",
          artifactId: chart.artifact.id,
        },
      ].map((entry) => ({ ...entry, deploymentId: deployment.id })),
    });
    await persistDeploymentRequest(tx, actor, {
      deployment: deployment,
      requestId: input.requestId,
      input: requestInput,
    });
    await audit(tx, actor, {
      action: "control_plane.requested",
      entityId: deployment.id,
      requestId: input.requestId,
      metadata: {
        reason: input.reason,
        previousArtifactId: prior.previousArtifact.id,
        nextArtifactId: next.artifact.id,
        chartArtifactId: chart.artifact.id,
      },
    });
    return DeploymentSchema.parse(wire(deployment));
  });
}
