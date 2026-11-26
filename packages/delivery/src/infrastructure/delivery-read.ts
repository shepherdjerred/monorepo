import {
  PipelineRevisionSchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  BuildSummarySchema,
  LatestQualifiedArtifactQuerySchema,
  LatestRetainableArtifactQuerySchema,
  ForumBaselineIntentSchema,
} from "#shared/contract.ts";
import type {
  LatestQualifiedArtifactQuery,
  LatestRetainableArtifactQuery,
} from "#shared/contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "./database.ts";
import { wire, required } from "./delivery-records.ts";
import { approvalView } from "./selection/views.ts";
import { selfHealingApplications } from "#shared/model/recipe-view.ts";
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
import { liveSet, precedesPipelineOrigin } from "./composition/automatic.ts";
import { doomed, type QualifyPendingBuild } from "./delivery-qualification.ts";

const RETAINABLE_PAGE = 20;

/** A set revision's entry for an exact component a qualified build of its service produced. */
async function qualifiedEntry(
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
    await qualifiedEntry(this.database, selected.id, input, repositoryId),
    `Qualified ${input.kind} artifact ${input.serviceId}/${input.component}`,
  );
  return artifactView(row.artifact);
}

/**
 * A producer's comparison base (B2): the component of the newest pending or
 * verified CI build of this repository whose order key is above the live
 * set's (R4) and below the producer's own pipeline, else the live set's
 * entry. The live set is the current lineage's (R5), so a carried set
 * (section 7) is a qualified base. A build that failed, or that reaches a
 * failed build through its pending references, is never a base. Retaining a
 * pending base defers the retaining build's qualification until it settles.
 * A retention whose original producer precedes the live entry's producer
 * also cannot serve as a base (R2).
 */
type RetainableCandidate = Prisma.BuildArtifactSelectionGetPayload<{
  include: { artifact: { include: { build: true } }; build: true };
}>;
type QualifiedEntryRow = NonNullable<
  Awaited<ReturnType<typeof qualifiedEntry>>
>;

function isStaleRetention(
  candidate: RetainableCandidate,
  liveEntry: QualifiedEntryRow | null,
): boolean {
  return (
    liveEntry !== null &&
    candidate.artifact.buildId !== candidate.buildId &&
    precedesPipelineOrigin(candidate.artifact.build, liveEntry.artifact.build)
  );
}

async function isViableRetainableCandidate(
  database: Database,
  candidate: RetainableCandidate,
  qualifyPending?: QualifyPendingBuild,
): Promise<boolean> {
  if (qualifyPending !== undefined && candidate.build.status === "pending") {
    const settled = await qualifyPending(candidate.build);
    if (settled === "failed") return false;
    if (settled === "verified") return true;
  }
  return !(await doomed(database, candidate.build, new Set(), qualifyPending));
}

async function selectRetainableFromPage(
  database: Database,
  page: readonly RetainableCandidate[],
  liveEntry: QualifiedEntryRow | null,
  qualifyPending?: QualifyPendingBuild,
) {
  for (const candidate of page) {
    if (isStaleRetention(candidate, liveEntry)) continue;
    if (await isViableRetainableCandidate(database, candidate, qualifyPending))
      return artifactView(candidate.artifact);
  }
  return null;
}

async function resolveFallbackEntry(options: {
  database: Database;
  input: LatestRetainableArtifactQuery;
  repositoryId: number;
  initialLiveId: string | null;
  initialLiveEntry: QualifiedEntryRow | null;
  qualifyPending: QualifyPendingBuild | undefined;
}) {
  if (options.qualifyPending === undefined) return options.initialLiveEntry;
  const currentLive = await liveSet(options.database, options.input.serviceId);
  if (currentLive === null) return null;
  if (currentLive.id === options.initialLiveId) return options.initialLiveEntry;
  return qualifiedEntry(
    options.database,
    currentLive.id,
    options.input,
    options.repositoryId,
  );
}

export async function latestRetainableArtifact(
  this: Delivery,
  rawInput: LatestRetainableArtifactQuery,
  repositoryId: number,
  qualifyPending?: QualifyPendingBuild,
) {
  const input = LatestRetainableArtifactQuerySchema.parse(rawInput);
  await ensureService(this.database, input.serviceId);
  const live = await liveSet(this.database, input.serviceId);
  const liveEntry =
    live === null
      ? null
      : await qualifiedEntry(this.database, live.id, input, repositoryId);
  const seenBuildIds: string[] = [];
  for (;;) {
    const page = await this.database.buildArtifactSelection.findMany({
      where: {
        ...(seenBuildIds.length === 0
          ? {}
          : { buildId: { notIn: seenBuildIds } }),
        component: input.component,
        artifact: { kind: input.kind },
        build: {
          serviceId: input.serviceId,
          repositoryId,
          sourceKind: "ci",
          status: { in: ["pending", "verified"] },
          pipelineNumber: {
            gt: live?.orderMajor ?? 0,
            lt: input.beforePipeline,
          },
        },
      } satisfies Prisma.BuildArtifactSelectionWhereInput,
      orderBy: [
        { build: { pipelineNumber: "desc" } },
        { build: { registrationSequence: "desc" } },
      ],
      include: { artifact: { include: { build: true } }, build: true },
      take: RETAINABLE_PAGE,
    });
    const selected = await selectRetainableFromPage(
      this.database,
      page,
      liveEntry,
      qualifyPending,
    );
    if (selected !== null) return selected;
    if (page.length < RETAINABLE_PAGE) break;
    seenBuildIds.push(...page.map((entry) => entry.buildId));
  }
  const row = required(
    await resolveFallbackEntry({
      database: this.database,
      input,
      repositoryId,
      initialLiveId: live?.id ?? null,
      initialLiveEntry: liveEntry,
      qualifyPending,
    }),
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
      selfHosted: service.selfHosted,
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
      selfHeals: selfHealingApplications(recipe.definition, service).length > 0,
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
