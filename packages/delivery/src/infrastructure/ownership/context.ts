import type { Delivery } from "#infrastructure/delivery.ts";
import {
  environment,
  pendingDeliveryObservations,
  type Transaction,
  configurationContent,
} from "#infrastructure/delivery-data.ts";
import { fingerprint, wire } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { LegacyPipelineRevisionSchema } from "#shared/contract.ts";
import { freezeForumBaseline } from "#infrastructure/forum/freezer.ts";
import { acceptedForumBaseline } from "#infrastructure/forum/baseline-context.ts";
import { readWorkerVersions } from "#infrastructure/worker-pool/pool.ts";
import {
  reviewedOwnershipDefinitions,
  requireReviewedOwnershipDefinition,
} from "./definitions.ts";

async function target(
  tx: Transaction,
  environmentId: string,
  definitions: Awaited<ReturnType<typeof reviewedOwnershipDefinitions>>,
) {
  const env = await environment(tx, environmentId);
  const pipeline = LegacyPipelineRevisionSchema.parse(
    wire(
      await tx.pipeline.findUniqueOrThrow({
        where: { id: env.pipelineRevisionId },
      }),
    ),
  );
  let baseline: {
    kind: "worker" | "forum";
    id: string;
    fingerprint: string;
  } | null = null;
  const definition = pipeline.definition;
  requireReviewedOwnershipDefinition(definitions, env, pipeline);
  if (definition.kind === "argocd" && definition.workerRollout !== undefined) {
    const versions = await readWorkerVersions(tx, env.id);
    const introducing = await tx.deployment.findMany({
      where: {
        id: { in: versions.map((version) => version.introducedByDeploymentId) },
        environmentId: env.id,
        status: "succeeded",
      },
      orderBy: { id: "asc" },
    });
    if (
      introducing.length !==
      new Set(versions.map((version) => version.introducedByDeploymentId)).size
    )
      throw new DeliveryError(
        "CONFLICT",
        "Worker ownership requires independently verified original retained hosts",
      );
    const original = introducing.find(
      (deployment) => deployment.kind === "adopt-worker",
    );
    if (original !== undefined)
      baseline = {
        kind: "worker",
        id: original.id,
        fingerprint: `sha256:${fingerprint({
          versions,
          introducing: introducing.map((row) => ({
            id: row.id,
            resultFingerprint: row.resultFingerprint,
            workerSnapshot: row.workerSnapshot,
          })),
        })}`,
      };
  }
  if (
    definition.kind === "argocd" &&
    definition.forumRelease !== undefined &&
    env.acceptedVersionSetRevisionId === null &&
    (await acceptedForumBaseline(tx, env.id)) !== null
  ) {
    const original = await freezeForumBaseline(tx, {
      environment: env,
      pipeline,
    });
    if (original === null)
      throw new DeliveryError(
        "CONFLICT",
        "Forum ownership requires its independently verified original runtime baseline",
      );
    baseline = {
      kind: "forum",
      id: original.intentId,
      fingerprint: `sha256:${fingerprint(original)}`,
    };
  }
  return {
    environmentId: env.id,
    serviceId: env.serviceId,
    application: env.application,
    generation: env.generation,
    pipelineRevisionId: pipeline.id,
    pipeline: definition,
    configurationRevision: env.declaredConfigurationId,
    configuration: await configurationContent(tx, env.declaredConfigurationId),
    acceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
    baseline,
  };
}

/** An uncapped, consistent PG read. External maintenance quiescence is still required; this is not a DB/native atomic transaction. */
export async function ownershipHandoverContext(
  delivery: Delivery,
  sourceRevision: string,
) {
  if (!/^[a-f0-9]{40}$/u.test(sourceRevision))
    throw new DeliveryError(
      "PAUSED",
      "Ownership handover requires an API image with genuine baked source identity",
    );
  const definitions = await reviewedOwnershipDefinitions();
  return delivery.database.$transaction(
    async (tx) => {
      const active = {
        status: { in: ["queued", "awaiting_approval", "running"] },
      };
      const [
        applicationLocks,
        platformLocks,
        activeEnvironments,
        pendingDeployments,
        recoveryRequired,
        pendingObservations,
        rows,
      ] = await Promise.all([
        tx.targetLock.count(),
        tx.platformLock.count(),
        tx.environment.count({ where: { activeDeploymentId: { not: null } } }),
        tx.deployment.count({ where: active }),
        tx.deployment.count({ where: { recoveryRequired: true } }),
        pendingDeliveryObservations(tx),
        tx.environment.findMany({
          where: { application: { not: null } },
          orderBy: { id: "asc" },
        }),
      ]);
      if (rows.length > 200)
        throw new DeliveryError(
          "INVALID",
          "Ownership handover exceeds the reviewed environment bound",
        );
      return {
        schema: "delivery-ownership-context/v1" as const,
        sourceRevision,
        catalogFingerprint: `sha256:${fingerprint(delivery.catalog.catalog)}`,
        observedAt: new Date().toISOString(),
        counts: {
          applicationLocks,
          platformLocks,
          activeEnvironments,
          pendingDeployments,
          recoveryRequired,
          pendingObservations,
        },
        targets: await Promise.all(
          rows.map((row) => target(tx, row.id, definitions)),
        ),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
