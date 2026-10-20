import {
  DeploymentSchema,
  DeploymentStatusSchema,
  StageSchema,
} from "#shared/contract.ts";
import type {
  ExecutionSummary,
  ExecutionTrace,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";
import {
  artifactView,
  environment as readEnvironment,
  version,
} from "#infrastructure/delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";
import { decodeCursor, olderThan, page, PAGE_SIZE } from "./cursor.ts";
import { deploymentLinks } from "./links.ts";
import { buildStatus, executionStatus } from "./status.ts";
import { promotionOrder } from "./topology.ts";
import { buildView, serviceSummary } from "./views.ts";

type BuildRow = Prisma.BuildGetPayload<object>;
type VersionRow = Prisma.VersionSetGetPayload<object>;
type DeploymentRow = Prisma.DeploymentGetPayload<object>;
type Root =
  | { kind: "build"; id: string; createdAt: Date; build: BuildRow }
  | { kind: "version"; id: string; createdAt: Date; version: VersionRow };

/** The newest deployment of each environment, in input order. */
export function latestPerEnvironment<
  T extends { environmentId: string; createdAt: Date },
>(deployments: T[]): T[] {
  const latest = new Map<string, T>();
  for (const deployment of deployments) {
    const current = latest.get(deployment.environmentId);
    if (
      current === undefined ||
      current.createdAt.getTime() < deployment.createdAt.getTime()
    )
      latest.set(deployment.environmentId, deployment);
  }
  return [...latest.values()];
}

function deploymentStatuses(deployments: DeploymentRow[]): PipelineStatus[] {
  return latestPerEnvironment(deployments).map((entry) =>
    DeploymentStatusSchema.parse(entry.status),
  );
}

async function executionDeployments(
  database: Database,
  build: BuildRow | null,
  versionSetId: string | null,
) {
  const clauses: Prisma.DeploymentWhereInput[] = [];
  if (versionSetId !== null)
    clauses.push({ versionSetRevisionId: versionSetId });
  if (build !== null) clauses.push({ platformSourceBuildId: build.id });
  if (clauses.length === 0) return [];
  return database.deployment.findMany({
    where: { OR: clauses },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { stages: true, environment: true },
  });
}

async function summarize(
  database: Database,
  root: Root,
): Promise<ExecutionSummary> {
  const build = root.kind === "build" ? root.build : null;
  const selected =
    root.kind === "version"
      ? root.version
      : await database.versionSet.findUnique({
          where: { qualifiedBuildId: root.id },
        });
  const deployments = await executionDeployments(
    database,
    build,
    selected?.id ?? null,
  );
  return {
    id: `${root.kind}:${root.id}`,
    status: executionStatus(
      build === null ? null : buildStatus(build.status),
      deploymentStatuses(deployments),
    ),
    build: build === null ? null : buildView(build),
    versionSet:
      selected === null
        ? null
        : { id: selected.id, revision: selected.revision },
    deployments: latestPerEnvironment(deployments).map((entry) => ({
      environmentId: entry.environmentId,
      deploymentId: entry.id,
      kind: DeploymentSchema.shape.kind.parse(entry.kind),
      status: DeploymentStatusSchema.parse(entry.status),
      createdAt: entry.createdAt.toISOString(),
      finishedAt: entry.finishedAt?.toISOString() ?? null,
    })),
    createdAt: root.createdAt.toISOString(),
  };
}

function newestFirst(builds: BuildRow[], composed: VersionRow[]): Root[] {
  return [
    ...builds.map((row) => ({
      kind: "build" as const,
      id: row.id,
      createdAt: row.createdAt,
      build: row,
    })),
    ...composed.map((row) => ({
      kind: "version" as const,
      id: row.id,
      createdAt: row.createdAt,
      version: row,
    })),
  ].toSorted(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id.localeCompare(left.id),
  );
}

const NEWEST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** The newest build or hand-composed version set of one service. */
export async function latestExecution(database: Database, serviceId: string) {
  const [build, composed] = await Promise.all([
    database.build.findFirst({ where: { serviceId }, orderBy: NEWEST }),
    database.versionSet.findFirst({
      where: { serviceId, qualifiedBuildId: null },
      orderBy: NEWEST,
    }),
  ]);
  const [root] = newestFirst(
    build === null ? [] : [build],
    composed === null ? [] : [composed],
  );
  return root === undefined ? null : summarize(database, root);
}

/** Builds and hand-composed version sets of one service, newest first. */
export async function serviceExecutions(
  database: Database,
  serviceId: string,
  rawCursor: string | undefined,
) {
  serviceSummary(serviceId);
  const cursor = decodeCursor(rawCursor);
  const [builds, composed] = await Promise.all([
    database.build.findMany({
      where: { serviceId, ...olderThan(cursor, "createdAt") },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
    }),
    database.versionSet.findMany({
      where: {
        serviceId,
        qualifiedBuildId: null,
        ...olderThan(cursor, "createdAt"),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
    }),
  ]);
  const roots = newestFirst(builds, composed);
  const selected = page(roots, PAGE_SIZE, (root) => root.createdAt);
  return {
    items: await Promise.all(
      selected.items.map((root) => summarize(database, root)),
    ),
    nextCursor: selected.nextCursor,
  };
}

async function trace(
  database: Database,
  serviceId: string,
  build: BuildRow | null,
  versionSetId: string | null,
): Promise<ExecutionTrace> {
  const [selected, deployments, environments, selections] = await Promise.all([
    versionSetId === null ? null : version(database, versionSetId),
    executionDeployments(database, build, versionSetId),
    database.environment.findMany({ where: { serviceId } }),
    build === null
      ? []
      : database.buildArtifactSelection.findMany({
          where: { buildId: build.id },
          include: { artifact: { include: { build: true } } },
        }),
  ]);
  const owned =
    build === null
      ? []
      : await database.artifact.findMany({
          where: { buildId: build.id },
          include: { build: true },
        });
  const artifacts = new Map(
    [...owned, ...selections.map((entry) => entry.artifact)].map((row) => [
      row.id,
      artifactView(row),
    ]),
  );
  return {
    service: serviceSummary(serviceId),
    status: executionStatus(
      build === null ? null : buildStatus(build.status),
      deploymentStatuses(deployments),
    ),
    build: build === null ? null : buildView(build),
    artifacts: [...artifacts.values()].toSorted((left, right) =>
      left.component.localeCompare(right.component),
    ),
    versionSet: selected,
    environments: promotionOrder(
      await Promise.all(
        environments.map((row) => readEnvironment(database, row.id)),
      ),
    ),
    deployments: deployments.map(({ stages, environment, ...row }) => ({
      ...DeploymentSchema.parse(wire(row)),
      stages: stages.map((stage) => StageSchema.parse(wire(stage))),
      links: deploymentLinks(row, environment.application),
    })),
  };
}

export async function buildTrace(database: Database, buildId: string) {
  const build = required(
    await database.build.findUnique({ where: { id: buildId } }),
    "Build",
  );
  const selected = await database.versionSet.findUnique({
    where: { qualifiedBuildId: build.id },
  });
  return trace(database, build.serviceId, build, selected?.id ?? null);
}

export async function versionTrace(database: Database, versionSetId: string) {
  const selected = required(
    await database.versionSet.findUnique({ where: { id: versionSetId } }),
    "Version set revision",
  );
  const build =
    selected.qualifiedBuildId === null
      ? null
      : await database.build.findUnique({
          where: { id: selected.qualifiedBuildId },
        });
  if (build === null && selected.qualifiedBuildId !== null)
    throw new DeliveryError("CONFLICT", "Qualified build is missing");
  return trace(database, selected.serviceId, build, selected.id);
}
