import {
  PipelineRevisionSchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  BuildSummarySchema,
  LatestQualifiedArtifactQuerySchema,
  ForumBaselineIntentSchema,
} from "#shared/contract.ts";
import type { LatestQualifiedArtifactQuery } from "#shared/contract.ts";
import { wire, required } from "./delivery-records.ts";
import { selfHealingApplication } from "#shared/model/recipe-view.ts";
import type { Delivery } from "./delivery.ts";
import { readRecoveredForumRuntime } from "./forum/recovered-runtime.ts";
import { minecraftIntentView } from "./minecraft-recovery/requests.ts";
import { platformIntentView } from "./platform-recovery/context.ts";
import { contentIntentView } from "./content-recovery/context.ts";
import {
  version as readVersion,
  environment,
  ensureService,
  artifactView,
  qualifiedBuildWhere,
  configurationRevision,
} from "./delivery-data.ts";

/** Resolve an exact component from the newest coherent automatic version set. */
export async function latestQualifiedArtifact(
  this: Delivery,
  rawInput: LatestQualifiedArtifactQuery,
  repositoryId: number,
) {
  const input = LatestQualifiedArtifactQuerySchema.parse(rawInput);
  await ensureService(this.database, input.serviceId);
  // The newest automatic set any qualified build of this repository's
  // service composed, by order key (B4, R4): CI, acquisition and attested
  // builds share one total order within the service.
  const builds = await this.database.build.findMany({
    where: qualifiedBuildWhere(input.serviceId, repositoryId),
    select: { id: true },
  });
  const matches = await this.database.versionSet.findMany({
    where: {
      serviceId: input.serviceId,
      automatic: true,
      qualifiedBuildId: { in: builds.map((build) => build.id) },
    },
    orderBy: [
      { orderMajor: { sort: "desc", nulls: "last" } },
      { orderMinor: { sort: "desc", nulls: "last" } },
      { revision: "desc" },
    ],
    take: 1,
    select: { id: true },
  });
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
          build: qualifiedBuildWhere(input.serviceId, repositoryId),
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
        approval: true,
        stages: true,
        recoveryIntents: { orderBy: { createdAt: "desc" } },
      },
    }),
    "Deployment",
  );
  const previousAccepted =
    row.previousAcceptedDeploymentId === null
      ? null
      : await this.database.deployment.findUniqueOrThrow({
          where: { id: row.previousAcceptedDeploymentId },
          select: { configurationId: true },
        });
  const [
    env,
    selected,
    pipeline,
    configuration,
    previousAcceptedVersionSet,
    previousAcceptedConfiguration,
  ] = await Promise.all([
    environment(this.database, row.environmentId),
    readVersion(this.database, row.versionSetRevisionId),
    this.database.pipeline.findUnique({
      where: { id: row.pipelineRevisionId },
    }),
    configurationRevision(this.database, row.configurationId),
    row.previousAcceptedVersionSetRevisionId === null
      ? null
      : readVersion(this.database, row.previousAcceptedVersionSetRevisionId),
    previousAccepted === null
      ? null
      : configurationRevision(this.database, previousAccepted.configurationId),
  ]);
  const intents = (kind: string) =>
    row.recoveryIntents.filter((intent) => intent.kind === kind);
  const recipe = PipelineRevisionSchema.parse(
    wire(required(pipeline, "Pipeline")),
  );
  const service = await this.database.service.findUniqueOrThrow({
    where: { id: row.serviceId },
  });
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
      configuration,
      previousAcceptedConfiguration,
      evidence: row.evidence.map(({ url, operationId, ...entry }) => ({
        ...entry,
        ...(url === null ? {} : { url }),
        ...(operationId === null ? {} : { operationId }),
      })),
      approval: approvalView(row.approval),
      stages: row.stages,
      selfHeals: selfHealingApplication(recipe.definition, service) !== null,
      minecraftRecoveries: intents("minecraft").map((intent) =>
        minecraftIntentView(intent),
      ),
      platformRecoveries: intents("platform").map((intent) =>
        platformIntentView(intent),
      ),
      contentRecoveries: intents("content").map((intent) =>
        contentIntentView(intent),
      ),
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

/** The approval as the API shows it; the bound selection fingerprint stays internal. */
function approvalView<T extends { boundFingerprint: string }>(
  row: T | null,
): Omit<T, "boundFingerprint"> | null {
  if (row === null) return null;
  const { boundFingerprint: _bound, ...view } = row;
  return view;
}
