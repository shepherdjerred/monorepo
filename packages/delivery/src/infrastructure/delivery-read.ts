import {
  ArtifactVersionSchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  BuildSummarySchema,
  LatestQualifiedArtifactQuerySchema,
} from "#shared/contract.ts";
import type { LatestQualifiedArtifactQuery } from "#shared/contract.ts";
import { wire, required } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  version as readVersion,
  environment,
  ensureService,
} from "./delivery-data.ts";

/** Resolve one exact CI-qualified artifact without consulting manual compositions. */
export async function latestQualifiedArtifact(
  this: Delivery,
  rawInput: LatestQualifiedArtifactQuery,
  repositoryId: number,
) {
  const input = LatestQualifiedArtifactQuerySchema.parse(rawInput);
  ensureService(input.serviceId);
  const row = required(
    await this.database.artifact.findFirst({
      where: {
        component: input.component,
        kind: input.kind,
        build: { serviceId: input.serviceId, repositoryId, status: "verified" },
      },
      orderBy: [{ build: { pipelineNumber: "desc" } }, { id: "asc" }],
      include: { build: true },
    }),
    `Qualified ${input.kind} artifact ${input.serviceId}/${input.component}`,
  );
  const { build, ...entry } = row;
  return ArtifactVersionSchema.parse(
    wire({
      ...entry,
      serviceId: build.serviceId,
      sourceRevision: build.sourceRevision,
    }),
  );
}

export async function detail(this: Delivery, deploymentId: string) {
  const row = required(
    await this.database.deployment.findUnique({
      where: { id: deploymentId },
      include: { evidence: true, approvals: true, stages: true },
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
  const [environments, deployments, versionSets, artifacts, builds] =
    await Promise.all([
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
    ]);
  return {
    environments: await Promise.all(
      environments.map((entry) => environment(this.database, entry.id)),
    ),
    deployments: deployments.map((entry) =>
      DeploymentSchema.parse(wire(entry)),
    ),
    versionSets,
    artifacts: artifacts.map(({ build, ...entry }) =>
      ArtifactVersionSchema.parse(
        wire({
          ...entry,
          serviceId: build.serviceId,
          sourceRevision: build.sourceRevision,
        }),
      ),
    ),
    builds: builds.map((entry) => BuildSummarySchema.parse(wire(entry))),
  };
}
