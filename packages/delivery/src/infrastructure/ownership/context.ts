import type { Delivery } from "#infrastructure/delivery.ts";
import {
  environment,
  pendingDeliveryObservations,
  type Transaction,
  configurationContent,
} from "#infrastructure/delivery-data.ts";
import { fingerprint, wire } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import {
  applicationsOf,
  forumReleaseOf,
  workerRolloutOf,
} from "#shared/model/recipe-view.ts";
import { freezeForumBaseline } from "#infrastructure/forum/freezer.ts";
import { acceptedForumBaseline } from "#infrastructure/forum/baseline-context.ts";
import { readWorkerVersions } from "#infrastructure/worker-pool/pool.ts";
import { activeEnvironmentIds } from "#infrastructure/delivery-selection.ts";
import {
  reconciledCatalog,
  requireCatalogOwnershipDefinition,
  type ReconciledCatalog,
} from "./definitions.ts";

async function target(
  tx: Transaction,
  environmentId: string,
  catalog: ReconciledCatalog,
) {
  const env = await environment(tx, environmentId);
  const pipeline = PipelineRevisionSchema.parse(
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
  await requireCatalogOwnershipDefinition(tx, catalog, env, pipeline);
  if (workerRolloutOf(definition) !== undefined) {
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
    forumReleaseOf(definition) !== undefined &&
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
  const shared = {
    environmentId: env.id,
    serviceId: env.serviceId,
    generation: env.generation,
    pipelineRevisionId: pipeline.id,
    pipeline: definition,
    configurationRevision: env.declaredConfigurationId,
    configuration: await configurationContent(tx, env.declaredConfigurationId),
    acceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
    baseline,
  };
  // Every Application the recipe deploys is a target, so a compound
  // environment hands over each of them, not only its primary one.
  return applicationsOf(definition).map((view) => ({
    ...shared,
    application: view.name,
  }));
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
  return delivery.database.$transaction(
    async (tx) => {
      const catalog = await reconciledCatalog(tx);
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
        admittingEnvironments,
        rows,
      ] = await Promise.all([
        tx.targetLock.count(),
        tx.platformLock.count(),
        tx.environment.count({ where: { activeDeploymentId: { not: null } } }),
        tx.deployment.count({ where: active }),
        tx.deployment.count({ where: { recoveryRequired: true } }),
        pendingDeliveryObservations(tx),
        // v2 admits by catalog lifecycle, never an enable-list flag (4.10).
        activeEnvironmentIds(tx),
        // Only an active environment's Application is handed over; a
        // retired one keeps its history and admits nothing (4.10).
        tx.environment.findMany({
          where: { application: { not: null }, lifecycle: "active" },
          orderBy: { id: "asc" },
        }),
      ]);
      const perEnvironment = await Promise.all(
        rows.map((row) => target(tx, row.id, catalog)),
      );
      const targets = perEnvironment.flat();
      if (targets.length > 200)
        throw new DeliveryError(
          "INVALID",
          "Ownership handover exceeds the reviewed target bound",
        );
      return {
        schema: "delivery-ownership-context/v1" as const,
        sourceRevision,
        catalogFingerprint: `sha256:${fingerprint(delivery.catalog.catalog)}`,
        // The definitions below come from this reconciled revision, not from
        // the image's catalog; the handover binds it to the reviewed one.
        catalogRevision: catalog.revision,
        observedAt: new Date().toISOString(),
        admittingEnvironments,
        counts: {
          applicationLocks,
          platformLocks,
          activeEnvironments,
          pendingDeployments,
          recoveryRequired,
          pendingObservations,
        },
        targets,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
