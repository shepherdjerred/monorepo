import { z } from "zod";
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

type BuildViewInput = Parameters<typeof buildView>[0];
type BuildRow = Prisma.BuildGetPayload<object>;
type VersionRow = Prisma.VersionSetGetPayload<object>;
type DeploymentRow = Prisma.DeploymentGetPayload<object>;
type SummaryDeploymentRow = Pick<
  DeploymentRow,
  | "id"
  | "environmentId"
  | "versionSetRevisionId"
  | "platformSourceBuildId"
  | "kind"
  | "status"
  | "createdAt"
  | "finishedAt"
>;
type Root =
  | { kind: "build"; id: string; createdAt: Date; build: BuildViewInput }
  | {
      kind: "version";
      id: string;
      createdAt: Date;
      version: Pick<VersionRow, "id" | "revision" | "createdAt">;
    };

const IdsSchema = z.array(z.object({ id: z.string() }));

const SUMMARY_DEPLOYMENT_SELECT = {
  id: true,
  environmentId: true,
  versionSetRevisionId: true,
  platformSourceBuildId: true,
  kind: true,
  status: true,
  createdAt: true,
  finishedAt: true,
} as const;

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

function deploymentStatuses(
  deployments: Pick<DeploymentRow, "environmentId" | "createdAt" | "status">[],
): PipelineStatus[] {
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

function toExecutionSummary(
  root: Root,
  selected: Pick<VersionRow, "id" | "revision"> | null,
  deployments: SummaryDeploymentRow[],
): ExecutionSummary {
  const build = root.kind === "build" ? root.build : null;
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
          select: { id: true, revision: true },
        });
  const clauses: Prisma.DeploymentWhereInput[] = [];
  if (selected !== null) clauses.push({ versionSetRevisionId: selected.id });
  if (build !== null) clauses.push({ platformSourceBuildId: build.id });
  const deployments =
    clauses.length === 0
      ? []
      : await database.deployment.findMany({
          where: { OR: clauses },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: SUMMARY_DEPLOYMENT_SELECT,
        });
  return toExecutionSummary(root, selected, deployments);
}

function newestFirst(
  builds: BuildViewInput[],
  composed: Pick<VersionRow, "id" | "revision" | "createdAt">[],
): Root[] {
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

async function latestComposedRows(
  database: Database,
  serviceIds: readonly string[],
) {
  const composedIds = IdsSchema.parse(
    await database.$queryRaw`
      SELECT v."id"
      FROM unnest(${[...serviceIds]}::text[]) AS s("serviceId")
      CROSS JOIN LATERAL (
        SELECT "id" FROM "VersionSet"
        WHERE "serviceId" = s."serviceId" AND "qualifiedBuildId" IS NULL
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 1
      ) v
    `,
  ).map((row) => row.id);
  if (composedIds.length === 0) return [];
  return database.versionSet.findMany({
    where: { id: { in: composedIds } },
    select: { id: true, serviceId: true, revision: true, createdAt: true },
  });
}

async function readSummaryDeployments(
  database: Database,
  setIds: string[],
  buildRootIds: string[],
) {
  const clauses: Prisma.DeploymentWhereInput[] = [];
  if (setIds.length > 0) clauses.push({ versionSetRevisionId: { in: setIds } });
  if (buildRootIds.length > 0)
    clauses.push({ platformSourceBuildId: { in: buildRootIds } });
  if (clauses.length === 0) return [];
  return database.deployment.findMany({
    where: { OR: clauses },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SUMMARY_DEPLOYMENT_SELECT,
  });
}

function indexDeployments(deployments: SummaryDeploymentRow[]) {
  const byVersionSet = new Map<string, SummaryDeploymentRow[]>();
  const byPlatformBuild = new Map<string, SummaryDeploymentRow[]>();
  for (const row of deployments) {
    const setList = byVersionSet.get(row.versionSetRevisionId) ?? [];
    setList.push(row);
    byVersionSet.set(row.versionSetRevisionId, setList);
    if (row.platformSourceBuildId !== null) {
      const buildList = byPlatformBuild.get(row.platformSourceBuildId) ?? [];
      buildList.push(row);
      byPlatformBuild.set(row.platformSourceBuildId, buildList);
    }
  }
  return { byVersionSet, byPlatformBuild };
}

function mergeRootDeployments(
  root: Root,
  selected: { id: string; revision: number } | null,
  indexed: ReturnType<typeof indexDeployments>,
): SummaryDeploymentRow[] {
  const fromSet =
    selected === null ? [] : (indexed.byVersionSet.get(selected.id) ?? []);
  const fromBuild =
    root.kind === "build" ? (indexed.byPlatformBuild.get(root.id) ?? []) : [];
  const deduped = new Map<string, SummaryDeploymentRow>();
  for (const row of [...fromSet, ...fromBuild]) deduped.set(row.id, row);
  return [...deduped.values()].toSorted(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Batched newest execution per service for `/api/v1/hub` (three queries across
 * all services instead of per-service N+1 queries).
 */
export async function latestExecutions(
  database: Database,
  serviceIds: readonly string[],
  latestBuildsByService: ReadonlyMap<string, BuildViewInput>,
): Promise<Map<string, ExecutionSummary>> {
  if (serviceIds.length === 0) return new Map();
  const composedRows = await latestComposedRows(database, serviceIds);
  const composedByService = new Map(
    composedRows.map((row) => [row.serviceId, row]),
  );
  const rootByService = new Map<string, Root>();
  for (const serviceId of serviceIds) {
    const build = latestBuildsByService.get(serviceId);
    const composed = composedByService.get(serviceId);
    const [root] = newestFirst(
      build === undefined ? [] : [build],
      composed === undefined ? [] : [composed],
    );
    if (root !== undefined) rootByService.set(serviceId, root);
  }
  const buildRootIds = [...rootByService.values()]
    .filter((root) => root.kind === "build")
    .map((root) => root.id);
  const buildSets =
    buildRootIds.length === 0
      ? []
      : await database.versionSet.findMany({
          where: { qualifiedBuildId: { in: buildRootIds } },
          select: { id: true, revision: true, qualifiedBuildId: true },
        });
  const setByBuildId = new Map(
    buildSets.flatMap((row) =>
      row.qualifiedBuildId === null ? [] : [[row.qualifiedBuildId, row]],
    ),
  );
  const setIds = [
    ...new Set([
      ...composedRows.map((row) => row.id),
      ...buildSets.map((row) => row.id),
    ]),
  ];
  const indexed = indexDeployments(
    await readSummaryDeployments(database, setIds, buildRootIds),
  );
  const summaries = new Map<string, ExecutionSummary>();
  for (const [serviceId, root] of rootByService) {
    const selected =
      root.kind === "version"
        ? root.version
        : (setByBuildId.get(root.id) ?? null);
    summaries.set(
      serviceId,
      toExecutionSummary(
        root,
        selected,
        mergeRootDeployments(root, selected, indexed),
      ),
    );
  }
  return summaries;
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
