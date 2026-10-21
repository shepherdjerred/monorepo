import {
  IdentifierSchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  BuildSummarySchema,
  LatestQualifiedArtifactQuerySchema,
  ForumBaselineIntentSchema,
} from "#shared/contract.ts";
import { z } from "zod";
import type { LatestQualifiedArtifactQuery } from "#shared/contract.ts";
import { wire, required } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { readRecoveredForumRuntime } from "./forum/recovered-runtime.ts";
import {
  version as readVersion,
  environment,
  ensureService,
  artifactView,
} from "./delivery-data.ts";

/** Resolve an exact component from the newest coherent automatic version set. */
export async function latestQualifiedArtifact(
  this: Delivery,
  rawInput: LatestQualifiedArtifactQuery,
  repositoryId: number,
) {
  const input = LatestQualifiedArtifactQuerySchema.parse(rawInput);
  ensureService(input.serviceId);
  const matches = z.array(z.object({ id: IdentifierSchema })).parse(
    await this.database.$queryRaw`
      SELECT version."id" FROM "VersionSet" version
      JOIN "Build" build ON build."id" = version."qualifiedBuildId"
      WHERE version."serviceId" = ${input.serviceId}
        AND build."serviceId" = ${input.serviceId}
        AND build."repositoryId" = ${repositoryId}
        AND build."status" = 'verified'
        AND build."sourceKind" = 'ci'
      ORDER BY build."pipelineNumber" DESC, version."revision" DESC LIMIT 1
    `,
  );
  const selected = required(
    matches[0] ?? null,
    "Qualified automatic version set",
  );
  const row = required(
    await this.database.versionSetEntry.findFirst({
      where: {
        revisionId: selected.id,
        component: input.component,
        artifact: {
          kind: input.kind,
          build: {
            serviceId: input.serviceId,
            status: "verified",
            OR: [
              { sourceKind: "ci", repositoryId },
              {
                sourceKind: {
                  in: ["upstream", "licensed-bundle", "attested"],
                },
                repositoryId: null,
              },
            ],
          },
        },
      },
      include: { artifact: { include: { build: true } } },
    }),
    `Qualified ${input.kind} artifact ${input.serviceId}/${input.component}`,
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
