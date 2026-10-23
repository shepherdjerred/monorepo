import { DeploymentSchema } from "#shared/contract.ts";
import { RestoreHoldSchema } from "#shared/model/cold-start-contract.ts";
import type {
  ActivityQuery,
  BuildListQuery,
  DeploymentListQuery,
  EnvironmentDetail,
} from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { wire } from "#infrastructure/delivery-records.ts";
import {
  artifactView,
  environment as readEnvironment,
} from "#infrastructure/delivery-data.ts";
import { argocdApplicationLink } from "@shepherdjerred/ops-model/tool-links.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import { releaseKindOf } from "#shared/deployment-request-contract.ts";
import { required } from "#infrastructure/delivery-records.ts";
import { decodeCursor, olderThan, page, PAGE_SIZE } from "./cursor.ts";
import { activityEntry, buildView, serviceSummary } from "./views.ts";
import { version } from "#infrastructure/delivery-data.ts";

export async function deploymentPage(
  database: Database,
  query: DeploymentListQuery,
) {
  const rows = await database.deployment.findMany({
    where: {
      ...(query.serviceId === undefined ? {} : { serviceId: query.serviceId }),
      ...(query.environmentId === undefined
        ? {}
        : { environmentId: query.environmentId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...olderThan(decodeCursor(query.cursor), "createdAt"),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });
  const selected = page(rows, PAGE_SIZE, (row) => row.createdAt);
  return {
    items: selected.items.map((row) => DeploymentSchema.parse(wire(row))),
    nextCursor: selected.nextCursor,
  };
}

export async function buildPage(database: Database, query: BuildListQuery) {
  const rows = await database.build.findMany({
    where: {
      ...(query.serviceId === undefined ? {} : { serviceId: query.serviceId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...olderThan(decodeCursor(query.cursor), "createdAt"),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    include: { artifacts: { include: { build: true } } },
  });
  const selected = page(rows, PAGE_SIZE, (row) => row.createdAt);
  return {
    items: selected.items.map(({ artifacts, ...row }) => ({
      ...buildView(row),
      artifacts: artifacts
        .map((artifact) => artifactView(artifact))
        .toSorted((left, right) =>
          left.component.localeCompare(right.component),
        ),
    })),
    nextCursor: selected.nextCursor,
  };
}

export async function activityPage(database: Database, query: ActivityQuery) {
  const rows = await database.audit.findMany({
    where: {
      ...(query.actor === undefined ? {} : { actor: query.actor }),
      ...(query.action === undefined
        ? {}
        : { action: { startsWith: query.action } }),
      ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      ...olderThan(decodeCursor(query.cursor), "occurredAt"),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });
  const selected = page(rows, PAGE_SIZE, (row) => row.occurredAt);
  return {
    items: selected.items.map((row) => activityEntry(row)),
    nextCursor: selected.nextCursor,
  };
}

/**
 * The recipe a release freezes: the accepted selection's until a rebind
 * moves it to the declared one, the declared recipe before the first
 * acceptance (E0, L2).
 */
async function releaseRecipeId(
  database: Database,
  env: { acceptedDeploymentId: string | null; pipelineRevisionId: string },
) {
  if (env.acceptedDeploymentId === null) return env.pipelineRevisionId;
  const accepted = required(
    await database.deployment.findUnique({
      where: { id: env.acceptedDeploymentId },
      select: { pipelineRevisionId: true },
    }),
    "Accepted deployment",
  );
  return accepted.pipelineRevisionId;
}

/** One environment with what its release forms need. */
export async function environmentDetail(
  database: Database,
  environmentId: string,
): Promise<EnvironmentDetail> {
  const env = await readEnvironment(database, environmentId);
  const [
    pipeline,
    releasePipeline,
    sourceEnvironment,
    versionRows,
    deployments,
    hold,
  ] = await Promise.all([
    database.pipeline.findUnique({ where: { id: env.pipelineRevisionId } }),
    releaseRecipeId(database, env).then(async (id) =>
      database.pipeline.findUnique({ where: { id } }),
    ),
    env.promotionSourceEnvironmentId === null
      ? null
      : readEnvironment(database, env.promotionSourceEnvironmentId),
    database.versionSet.findMany({
      where: { serviceId: env.serviceId },
      orderBy: { revision: "desc" },
      take: 50,
    }),
    database.deployment.findMany({
      where: { environmentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    database.environment.findUniqueOrThrow({
      where: { id: environmentId },
      select: { restoreHold: true },
    }),
  ]);
  return {
    environment: env,
    service: serviceSummary(env.serviceId),
    pipeline: PipelineRevisionSchema.parse(
      wire(required(pipeline, "Pipeline")),
    ),
    sourceEnvironment,
    restoreHold:
      hold.restoreHold === null
        ? null
        : RestoreHoldSchema.parse(hold.restoreHold),
    releaseKind: releaseKindOf(
      PipelineRevisionSchema.parse(
        wire(required(releasePipeline, "Release pipeline")),
      ).definition.kind,
    ),
    versionSets: await Promise.all(
      versionRows.map((row) => version(database, row.id)),
    ),
    deployments: deployments.map((row) => DeploymentSchema.parse(wire(row))),
    links:
      env.application === null ? [] : [argocdApplicationLink(env.application)],
  };
}
