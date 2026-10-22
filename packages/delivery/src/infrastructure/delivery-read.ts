import {
  IdentifierSchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  BuildSummarySchema,
  LatestQualifiedArtifactQuerySchema,
  LatestRetainableArtifactQuerySchema,
  ForumBaselineIntentSchema,
} from "#shared/contract.ts";
import { z } from "zod";
import type {
  LatestQualifiedArtifactQuery,
  LatestRetainableArtifactQuery,
} from "#shared/contract.ts";
import type { Database } from "./database.ts";
import { wire, required } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { readRecoveredForumRuntime } from "./forum/recovered-runtime.ts";
import {
  version as readVersion,
  environment,
  ensureService,
  artifactView,
  qualifiedBuildWhere,
} from "./delivery-data.ts";
import { doomed } from "./delivery-qualification.ts";

const RETAINABLE_PAGE = 20;

/** The live automatic set (R4): the newest set a verified CI build of this repository composed. */
async function liveAutomaticSet(
  database: Database,
  serviceId: string,
  repositoryId: number,
) {
  const matches = z
    .array(z.object({ id: IdentifierSchema, pipelineNumber: z.number() }))
    .parse(
      await database.$queryRaw`
      SELECT version."id", build."pipelineNumber" FROM "VersionSet" version
      JOIN "Build" build ON build."id" = version."qualifiedBuildId"
      WHERE version."serviceId" = ${serviceId}
        AND build."serviceId" = ${serviceId}
        AND build."repositoryId" = ${repositoryId}
        AND build."status" = 'verified'
        AND build."sourceKind" = 'ci'
      ORDER BY build."pipelineNumber" DESC, version."revision" DESC LIMIT 1
    `,
    );
  return matches[0] ?? null;
}

async function liveEntry(
  database: Database,
  revisionId: string,
  input: LatestQualifiedArtifactQuery,
  repositoryId: number,
) {
  return database.versionSetEntry.findFirst({
    where: {
      revisionId,
      component: input.component,
      artifact: {
        kind: input.kind,
        build: qualifiedBuildWhere(input.serviceId, repositoryId),
      },
    },
    include: { artifact: { include: { build: true } } },
  });
}

/** Resolve an exact component from the newest coherent automatic version set. */
export async function latestQualifiedArtifact(
  this: Delivery,
  rawInput: LatestQualifiedArtifactQuery,
  repositoryId: number,
) {
  const input = LatestQualifiedArtifactQuerySchema.parse(rawInput);
  ensureService(input.serviceId);
  const selected = required(
    await liveAutomaticSet(this.database, input.serviceId, repositoryId),
    "Qualified automatic version set",
  );
  const row = required(
    await liveEntry(this.database, selected.id, input, repositoryId),
    `Qualified ${input.kind} artifact ${input.serviceId}/${input.component}`,
  );
  return artifactView(row.artifact);
}

/**
 * A producer's comparison base (B2): the component of the newest pending or
 * verified CI build of this repository between the live automatic set and the
 * producer's own pipeline, else the live set's entry. A build that failed, or
 * that reaches a failed build through its pending references, is never a base;
 * builds the live set supersedes (R4) are outside the current lineage. Retaining a
 * pending base defers the retaining build's qualification until it settles.
 */
export async function latestRetainableArtifact(
  this: Delivery,
  rawInput: LatestRetainableArtifactQuery,
  repositoryId: number,
) {
  const input = LatestRetainableArtifactQuerySchema.parse(rawInput);
  ensureService(input.serviceId);
  const live = await liveAutomaticSet(
    this.database,
    input.serviceId,
    repositoryId,
  );
  const where = {
    component: input.component,
    artifact: { kind: input.kind },
    build: {
      serviceId: input.serviceId,
      repositoryId,
      sourceKind: "ci",
      status: { in: ["pending", "verified"] },
      pipelineNumber: {
        gt: live?.pipelineNumber ?? 0,
        lt: input.beforePipeline,
      },
    },
  };
  for (let skip = 0; ; skip += RETAINABLE_PAGE) {
    const page = await this.database.buildArtifactSelection.findMany({
      where,
      orderBy: [
        { build: { pipelineNumber: "desc" } },
        { build: { registrationSequence: "desc" } },
      ],
      include: { artifact: { include: { build: true } }, build: true },
      skip,
      take: RETAINABLE_PAGE,
    });
    // The qualifier will fail a doomed build, so it is no base.
    for (const candidate of page)
      if (!(await doomed(this.database, candidate.build)))
        return artifactView(candidate.artifact);
    if (page.length < RETAINABLE_PAGE) break;
  }
  const row = required(
    live === null
      ? null
      : await liveEntry(this.database, live.id, input, repositoryId),
    `Retainable ${input.kind} artifact ${input.serviceId}/${input.component}`,
  );
  return artifactView(row.artifact);
}

export async function detail(this: Delivery, deploymentId: string) {
  const row = required(
    await this.database.deployment.findUnique({
      where: { id: deploymentId },
      include: {
        evidence: true,
        approvals: true,
        stages: true,
        minecraftRecoveries: { orderBy: { createdAt: "desc" } },
        platformRecoveries: { orderBy: { createdAt: "desc" } },
        contentRecoveries: { orderBy: { createdAt: "desc" } },
      },
    }),
    "Deployment",
  );
  const [env, selected, pipeline, previousAcceptedVersionSet] =
    await Promise.all([
      environment(this.database, row.environmentId),
      readVersion(this.database, row.versionSetRevisionId),
      this.database.pipeline.findUnique({
        where: { id: row.pipelineRevisionId },
      }),
      row.previousAcceptedVersionSetRevisionId === null
        ? null
        : readVersion(this.database, row.previousAcceptedVersionSetRevisionId),
    ]);
  return DeploymentDetailSchema.parse(
    wire({
      deployment: row,
      forumRecoveredRuntime: await readRecoveredForumRuntime(
        this.database,
        row.id,
      ),
      environment: env,
      versionSet: selected,
      previousAcceptedVersionSet,
      pipeline: required(pipeline, "Pipeline"),
      evidence: row.evidence.map(({ url, operationId, ...entry }) => ({
        ...entry,
        ...(url === null ? {} : { url }),
        ...(operationId === null ? {} : { operationId }),
      })),
      approvals: row.approvals,
      stages: row.stages,
      minecraftRecoveries: row.minecraftRecoveries,
      platformRecoveries: row.platformRecoveries,
      contentRecoveries: row.contentRecoveries,
    }),
  );
}

export async function versions(this: Delivery, serviceId?: string) {
  const rows = await this.database.versionSet.findMany({
    ...(serviceId === undefined ? {} : { where: { serviceId } }),
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Promise.all(rows.map((entry) => readVersion(this.database, entry.id)));
}

export function version(this: Delivery, revisionId: string) {
  return readVersion(this.database, revisionId);
}

export async function overview(this: Delivery) {
  const [
    environments,
    deployments,
    versionSets,
    artifacts,
    builds,
    forumBaselines,
  ] = await Promise.all([
    this.database.environment.findMany({ orderBy: { id: "asc" } }),
    this.database.deployment.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    this.versions(),
    this.database.artifact.findMany({
      where: { build: { status: "verified" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { build: true },
    }),
    this.database.build.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    this.database.forumBaselineIntent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    environments: await Promise.all(
      environments.map((entry) => environment(this.database, entry.id)),
    ),
    deployments: deployments.map((entry) =>
      DeploymentSchema.parse(wire(entry)),
    ),
    versionSets,
    artifacts: artifacts.map((entry) => artifactView(entry)),
    builds: builds.map((entry) => BuildSummarySchema.parse(wire(entry))),
    forumBaselines: forumBaselines.map((entry) =>
      ForumBaselineIntentSchema.parse(wire(entry)),
    ),
  };
}
