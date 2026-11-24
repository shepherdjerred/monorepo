import {
  CATALOG_CORE,
  type CatalogCore,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import {
  ApprovalPolicySchema,
  DeploymentStatusSchema,
  LifecycleSchema,
} from "#shared/contract.ts";
import type {
  Attention,
  GridEnvironment,
  GridService,
  HubGrid,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  attentionItems,
  awaitingDecisions,
  decisionStatus,
  deploymentSubjects,
  latestBuilds,
  latestDeployments,
  priorDeployments,
  statedDeployments,
  type AlarmedRelease,
  type AttentionDeployment,
  type PriorDeployment,
} from "./attention.ts";
import { promotionOrder } from "./topology.ts";
import { servicePlacement } from "./views.ts";

type EnvironmentRow = Pick<
  Prisma.EnvironmentGetPayload<object>,
  | "id"
  | "serviceId"
  | "name"
  | "lifecycle"
  | "promotionSourceEnvironmentId"
  | "approvalPolicy"
  | "acceptedVersionSetRevisionId"
  | "acceptedDeploymentId"
  | "activeDeploymentId"
>;
type BuildRow = Pick<
  Prisma.BuildGetPayload<object>,
  "id" | "status" | "qualificationReason" | "createdAt"
>;
type LatestBuildMap = Awaited<ReturnType<typeof latestBuilds>>;

/** The newest deployment of an environment, with the set revision it deploys. */
export type GridDeployment = AttentionDeployment &
  Pick<Prisma.DeploymentGetPayload<object>, "versionSetRevisionId">;

/** What the grid reads of a deployment that accepted its environment's selection. */
export type AcceptingDeployment = Pick<
  Prisma.DeploymentGetPayload<object>,
  "finishedAt" | "monitorState" | "monitorAlarmedAt"
>;

/** The rows the grid is built from, each read once for every service. */
export type GridRecord = {
  services: readonly { id: string; lifecycle: string }[];
  environments: readonly EnvironmentRow[];
  /** The newest deployment of each environment, by environment id. */
  latest: ReadonlyMap<string, GridDeployment>;
  /** The deployments just before each environment's newest, newest first, by environment id. */
  prior: ReadonlyMap<string, readonly PriorDeployment[]>;
  /** Deployments awaiting approval or a saved-plan decision, newest first. */
  awaiting: readonly AttentionDeployment[];
  /** The newest build of each service, by service id. */
  builds: ReadonlyMap<string, BuildRow>;
  /** Revision numbers of the accepted, newest and awaiting set revisions, by set revision id. */
  revisions: ReadonlyMap<string, number>;
  /** Each accepting deployment, by deployment id. */
  accepting: ReadonlyMap<string, AcceptingDeployment>;
  /** When the record was read, so a long queue can be told from a short one. */
  now: Date;
};

const isActive = (row: { lifecycle: string }) =>
  LifecycleSchema.parse(row.lifecycle) === "active";

function revisionOf(record: GridRecord, setId: string, missing: string) {
  const revision = record.revisions.get(setId);
  if (revision === undefined) throw new Error(missing);
  return revision;
}

function acceptingOf(record: GridRecord, env: EnvironmentRow) {
  if (env.acceptedDeploymentId === null) return null;
  const accepting = record.accepting.get(env.acceptedDeploymentId);
  if (accepting === undefined)
    throw new Error(
      `Environment ${env.id} names an accepting deployment the record does not hold`,
    );
  return accepting;
}

/** When a monitor alarm fired on the release an environment accepted; null when none fired. */
function alarmedAt(record: GridRecord, env: EnvironmentRow) {
  const accepting = acceptingOf(record, env);
  if (accepting?.monitorState !== "alarmed") return null;
  if (accepting.monitorAlarmedAt === null)
    throw new Error(
      `Environment ${env.id}'s alarmed release has no alarm time`,
    );
  return accepting.monitorAlarmedAt;
}

/** The deployment kinds that maintain the accepted release without changing it. */
const MAINTENANCE_KINDS: ReadonlySet<string> = new Set(["retire-host"]);

/** The states in which a maintenance deployment is still open. */
const OPEN_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "awaiting_approval",
]);

/**
 * Whether a deployment only maintains what the environment already accepted:
 * retiring a drained worker deploys the accepted release again, so while it
 * is open it is no pending release. One that ended stays a request, so a
 * failed retirement still reads as the failure it is.
 */
function isOpenMaintenance(
  env: EnvironmentRow,
  deployment: GridDeployment,
  status: GridEnvironment["status"],
) {
  return (
    MAINTENANCE_KINDS.has(deployment.kind) &&
    OPEN_STATUSES.has(status) &&
    !deployment.recoveryRequired &&
    env.acceptedDeploymentId !== null &&
    deployment.id !== env.acceptedDeploymentId &&
    deployment.versionSetRevisionId === env.acceptedVersionSetRevisionId
  );
}

function gridEnvironment(
  env: EnvironmentRow,
  record: GridRecord,
  listed: ReadonlySet<string>,
): GridEnvironment {
  const deployment = record.latest.get(env.id);
  const source = env.promotionSourceEnvironmentId;
  const revision =
    env.acceptedVersionSetRevisionId === null
      ? null
      : revisionOf(
          record,
          env.acceptedVersionSetRevisionId,
          `Environment ${env.id} accepts a set revision the record does not hold`,
        );
  const finished = acceptingOf(record, env)?.finishedAt ?? null;
  const newest =
    deployment === undefined
      ? "not_started"
      : decisionStatus(deployment, record.awaiting);
  const maintenance =
    deployment !== undefined && isOpenMaintenance(env, deployment, newest)
      ? deployment
      : null;
  return {
    id: env.id,
    name: env.name,
    // Open maintenance of the accepted release leaves the environment's
    // standing with the deployment that accepted it.
    status: maintenance === null ? newest : "succeeded",
    request:
      deployment === undefined ||
      maintenance !== null ||
      deployment.id === env.acceptedDeploymentId
        ? null
        : {
            deploymentId: deployment.id,
            revision: revisionOf(
              record,
              deployment.versionSetRevisionId,
              `Deployment ${deployment.id} deploys a set revision the record does not hold`,
            ),
          },
    ...(maintenance === null
      ? {}
      : {
          maintenance: {
            kind: "retire-host" as const,
            status: DeploymentStatusSchema.parse(newest),
            deploymentId: maintenance.id,
          },
        }),
    alarmedAt: alarmedAt(record, env)?.toISOString() ?? null,
    recoveryRequired: deployment?.recoveryRequired ?? false,
    acceptedRevision: revision,
    acceptedAt: finished?.toISOString() ?? null,
    approvalRequired:
      ApprovalPolicySchema.parse(env.approvalPolicy) === "required",
    activeDeploymentId: env.activeDeploymentId,
    promotesFrom: source !== null && listed.has(source) ? source : null,
  };
}

function gridEnvironments(
  environments: readonly EnvironmentRow[],
  record: GridRecord,
): GridEnvironment[] {
  const listed = new Set(environments.map((env) => env.id));
  return promotionOrder([...environments]).map((env) =>
    gridEnvironment(env, record, listed),
  );
}

/** The active services this server's catalog places, with their title and group, and those services' active environments. */
export function listedRecord(
  record: GridRecord,
  catalog: CatalogCore = CATALOG_CORE,
) {
  const services = new Map<
    string,
    NonNullable<ReturnType<typeof servicePlacement>>
  >();
  for (const service of record.services) {
    if (!isActive(service)) continue;
    const placement = servicePlacement(service.id, catalog);
    if (placement !== undefined) services.set(service.id, placement);
  }
  return {
    services,
    environments: record.environments.filter(
      (env) => isActive(env) && services.has(env.serviceId),
    ),
  };
}

/**
 * What needs someone, from one read of the record. Every page that lists
 * attention takes it from here, so Overview and Pipelines can never disagree:
 * an item exists only for a service and an environment a page lists, never
 * for a retired service or environment, or one the catalog does not declare,
 * whatever deployments the record still holds for it.
 */
export function gridAttention(
  record: GridRecord,
  catalog: CatalogCore = CATALOG_CORE,
): Attention[] {
  const { services, environments } = listedRecord(record, catalog);
  const watched = new Set(environments.map((env) => env.id));
  return attentionItems({
    awaiting: record.awaiting.filter((deployment) =>
      watched.has(deployment.environmentId),
    ),
    latest: [...record.latest.values()].filter((deployment) =>
      watched.has(deployment.environmentId),
    ),
    prior: record.prior,
    alarms: environments.flatMap((env): AlarmedRelease[] => {
      const at = alarmedAt(record, env);
      if (at === null) return [];
      if (env.acceptedVersionSetRevisionId === null)
        throw new Error(`Environment ${env.id} alarmed with nothing accepted`);
      return [
        {
          environmentId: env.id,
          serviceId: env.serviceId,
          versionSetRevisionId: env.acceptedVersionSetRevisionId,
          alarmedAt: at,
        },
      ];
    }),
    failedBuilds: [...services].flatMap(([serviceId, placement]) => {
      const build = record.builds.get(serviceId);
      return build?.status === "failed"
        ? [
            {
              id: build.id,
              serviceId,
              serviceTitle: placement.title,
              reason: build.qualificationReason,
              at: build.createdAt.toISOString(),
            },
          ]
        : [];
    }),
    subject: deploymentSubjects(record.environments),
    revisions: record.revisions,
    now: record.now,
  });
}

/**
 * The overview grid from one read of the record: every active service this
 * server's catalog declares, under its catalog group, with what Delivery last
 * recorded for each active environment. A service the record holds and the
 * catalog does not is left out, as every other hub read does: no page could
 * title it.
 */
export function buildGrid(
  record: GridRecord,
  catalog: CatalogCore = CATALOG_CORE,
): HubGrid {
  const { services: listed, environments } = listedRecord(record, catalog);
  const members = new Map<string, GridService[]>();
  for (const [serviceId, placement] of listed) {
    const group = members.get(placement.group.id) ?? [];
    group.push({
      id: serviceId,
      title: placement.title,
      environments: gridEnvironments(
        environments.filter((env) => env.serviceId === serviceId),
        record,
      ),
    });
    members.set(placement.group.id, group);
  }
  return {
    groups: catalog.groups.flatMap((group) => {
      const services = members.get(group.id);
      return services === undefined
        ? []
        : [
            {
              id: group.id,
              title: group.title,
              kind: group.kind,
              services: services.toSorted(
                (left, right) =>
                  left.title.localeCompare(right.title) ||
                  left.id.localeCompare(right.id),
              ),
            },
          ];
    }),
    attention: gridAttention(record, catalog),
  };
}

/**
 * The record the grid and every attention list are built from. Eleven
 * statements whatever the number of services: every row is read by set, never
 * per service or per environment, and no execution is traced.
 */
export async function readGridRecord(
  database: Database,
): Promise<Omit<GridRecord, "builds"> & { builds: LatestBuildMap }> {
  const [services, environments, newest, before, builds, awaiting] =
    await Promise.all([
      database.service.findMany({ select: { id: true, lifecycle: true } }),
      database.environment.findMany(),
      latestDeployments(database),
      priorDeployments(database),
      latestBuilds(database),
      awaitingDecisions(database),
    ]);
  const { latest, prior } = await statedDeployments(database, newest, before);
  const ids = <T>(pick: (env: (typeof environments)[number]) => T | null) =>
    environments.flatMap((env) => {
      const value = pick(env);
      return value === null ? [] : [value];
    });
  const [sets, accepting] = await Promise.all([
    database.versionSet.findMany({
      where: {
        id: {
          in: [
            ...ids((env) => env.acceptedVersionSetRevisionId),
            ...[...latest.values(), ...awaiting].map(
              (row) => row.versionSetRevisionId,
            ),
          ],
        },
      },
      select: { id: true, revision: true },
    }),
    database.deployment.findMany({
      where: { id: { in: ids((env) => env.acceptedDeploymentId) } },
      select: {
        id: true,
        finishedAt: true,
        monitorState: true,
        monitorAlarmedAt: true,
      },
    }),
  ]);
  return {
    services,
    environments,
    latest,
    prior,
    awaiting,
    builds,
    revisions: new Map(sets.map((row) => [row.id, row.revision])),
    accepting: new Map(accepting.map((row) => [row.id, row])),
    now: new Date(),
  };
}

/** `GET /hub/grid`. */
export async function hubGrid(database: Database): Promise<HubGrid> {
  return buildGrid(await readGridRecord(database));
}
