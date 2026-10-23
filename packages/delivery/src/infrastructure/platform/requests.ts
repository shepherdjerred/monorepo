import { beginDeploymentRequest } from "#infrastructure/deployment-request-store.ts";
import { persistDeploymentRequest } from "#infrastructure/delivery-records.ts";
import { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import { DeliveryError } from "#domain/error.ts";
import type { PlatformReleaseSnapshotSchema } from "#shared/contract.ts";
import {
  CreatePlatformDeploymentSchema,
  DeploymentSchema,
  LegacyPipelineRevisionSchema,
  type CreatePlatformDeployment,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import {
  serviceCatalogRevision,
  id,
  requestApproval,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { audit, required, wire } from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { freezePlatformSnapshot } from "./snapshot.ts";
import { requirePlatformOwner, validatePlatformEnvironment } from "./policy.ts";

async function anchor(
  tx: Transaction,
  snapshot: ReturnType<typeof PlatformReleaseSnapshotSchema.parse>,
) {
  const selection = await tx.buildArtifactSelection.findUnique({
    where: {
      buildId_component: {
        buildId: snapshot.source.id,
        component: "chart:apps",
      },
    },
  });
  const root = selection?.artifactId;
  if (root === undefined)
    throw new DeliveryError(
      "INVALID",
      "Platform source requires its original qualified apps chart anchor",
    );
  return required(
    await tx.versionSet.findFirst({
      where: {
        serviceId: "gitops",
        qualifiedBuildId: { not: null },
        entries: { some: { component: "chart:apps", artifactId: root } },
      },
      orderBy: { revision: "desc" },
    }),
    "Original qualified gitops chart anchor",
  );
}

export async function createPlatformDeployment(
  this: Delivery,
  raw: CreatePlatformDeployment,
  actor: Principal,
  automatic = false,
) {
  if (!automatic) requireScope(actor, "deploy");
  const input = CreatePlatformDeploymentSchema.parse(raw);
  const requestInput = { ...input, automatic };
  return this.database.$transaction(async (tx) => {
    const selection = await beginDeploymentRequest(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      environmentId: input.environmentId,
    });
    if (selection.kind === "replayed") return selection.deployment;
    const env = selection.environment;
    if (
      env.generation !== input.expectedGeneration ||
      env.activeDeploymentId !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Platform environment generation or ownership changed",
      );
    if (
      (await tx.deployment.count({
        where: {
          environmentId: env.id,
          status: { in: ["queued", "awaiting_approval", "running"] },
        },
      })) !== 0
    )
      throw new DeliveryError(
        "CONFLICT",
        "Platform environment already has pending or active work",
      );
    const pipeline = LegacyPipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: env.pipelineRevisionId },
          }),
          "Platform pipeline",
        ),
      ),
    );
    validatePlatformEnvironment(
      {
        ...env,
        application: env.application ?? undefined,
        promotionSourceEnvironmentId:
          env.promotionSourceEnvironmentId ?? undefined,
      },
      pipeline.definition,
    );
    requirePlatformOwner(this.catalog, input.kind);
    const snapshot = await freezePlatformSnapshot(
      tx,
      this,
      input,
      pipeline.definition,
    );
    const selected = await anchor(tx, snapshot);
    const approval =
      snapshot.kind === "tofu-apply" &&
      tofuStackPolicy(snapshot.stack).mode === "reviewed-plan";
    const deployment = await tx.deployment.create({
      data: {
        id: id(),
        requestId: input.requestId,
        environmentId: env.id,
        serviceId: "gitops",
        versionSetRevisionId: selected.id,
        pipelineRevisionId: pipeline.id,
        configurationId: env.declaredConfigurationId,
        catalogRevision: await serviceCatalogRevision(tx, env.serviceId),
        expectedGeneration: env.generation,
        kind: input.kind,
        automatic,
        requestedBy: actor.id,
        status: approval ? "awaiting_approval" : "queued",
        platformSnapshot: snapshot,
        platformSourceBuildId: snapshot.source.id,
      },
    });
    if (approval) await requestApproval(tx, deployment);
    await persistDeploymentRequest(tx, actor, {
      deployment: deployment,
      requestId: input.requestId,
      input: requestInput,
    });
    await audit(tx, actor, {
      action: "platform.requested",
      entityId: deployment.id,
      requestId: input.requestId,
      metadata: { kind: snapshot.kind, sourceBuildId: snapshot.source.id },
    });
    return DeploymentSchema.parse(wire(deployment));
  });
}
