import {
  CATALOG_CORE,
  type CatalogCore,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { ApprovalPolicySchema, LifecycleSchema } from "#shared/contract.ts";
import {
  GridEnvironmentStatusSchema,
  type GridEnvironment,
  type GridService,
  type HubGrid,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  attentionItems,
  deploymentSubjects,
  latestBuilds,
  latestDeployments,
  type AttentionDeployment,
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

/** The rows the grid is built from, each read once for every service. */
export type GridRecord = {
  services: readonly { id: string; lifecycle: string }[];
  environments: readonly EnvironmentRow[];
  /** The newest deployment of each environment, by environment id. */
  latest: ReadonlyMap<string, AttentionDeployment>;
  awaiting: readonly AttentionDeployment[];
  /** The newest build of each service, by service id. */
  builds: ReadonlyMap<string, BuildRow>;
  /** Revision numbers of the accepted set revisions, by set revision id. */
  revisions: ReadonlyMap<string, number>;
  /** When each accepting deployment finished, by deployment id. */
  finished: ReadonlyMap<string, Date | null>;
};

const isActive = (row: { lifecycle: string }) =>
  LifecycleSchema.parse(row.lifecycle) === "active";

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
      : record.revisions.get(env.acceptedVersionSetRevisionId);
  if (revision === undefined)
    throw new Error(
      `Environment ${env.id} accepts a set revision the record does not hold`,
    );
  const finished =
    env.acceptedDeploymentId === null
      ? null
      : record.finished.get(env.acceptedDeploymentId);
  if (finished === undefined)
    throw new Error(
      `Environment ${env.id} names an accepting deployment the record does not hold`,
    );
  return {
    id: env.id,
    name: env.name,
    status: GridEnvironmentStatusSchema.parse(
      deployment === undefined ? "not_started" : deployment.status,
    ),
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
  const environments = record.environments.filter((env) => isActive(env));
  const members = new Map<string, GridService[]>();
  const listed = new Map<string, string>();
  for (const service of record.services) {
    if (!isActive(service)) continue;
    const placement = servicePlacement(service.id, catalog);
    if (placement === undefined) continue;
    listed.set(service.id, placement.title);
    const group = members.get(placement.group.id) ?? [];
    group.push({
      id: service.id,
      title: placement.title,
      environments: gridEnvironments(
        environments.filter((env) => env.serviceId === service.id),
        record,
      ),
    });
    members.set(placement.group.id, group);
  }
  const watched = new Set(environments.map((env) => env.id));
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
    attention: attentionItems({
      awaiting: record.awaiting.filter((deployment) =>
        watched.has(deployment.environmentId),
      ),
      latest: [...record.latest.values()].filter((deployment) =>
        watched.has(deployment.environmentId),
      ),
      failedBuilds: [...listed].flatMap(([serviceId, serviceTitle]) => {
        const build = record.builds.get(serviceId);
        return build?.status === "failed"
          ? [
              {
                id: build.id,
                serviceId,
                serviceTitle,
                reason: build.qualificationReason,
                at: build.createdAt.toISOString(),
              },
            ]
          : [];
      }),
      subject: deploymentSubjects(record.environments),
    }),
  };
}

/**
 * `GET /hub/grid`. Nine statements whatever the number of services: every row
 * is read by set, never per service or per environment, and no execution is
 * traced.
 */
export async function hubGrid(database: Database): Promise<HubGrid> {
  const [services, environments, latest, builds, awaiting] = await Promise.all([
    database.service.findMany({ select: { id: true, lifecycle: true } }),
    database.environment.findMany(),
    latestDeployments(database),
    latestBuilds(database),
    database.deployment.findMany({
      where: { status: "awaiting_approval" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const ids = <T>(pick: (env: (typeof environments)[number]) => T | null) =>
    environments.flatMap((env) => {
      const value = pick(env);
      return value === null ? [] : [value];
    });
  const [accepted, accepting] = await Promise.all([
    database.versionSet.findMany({
      where: { id: { in: ids((env) => env.acceptedVersionSetRevisionId) } },
      select: { id: true, revision: true },
    }),
    database.deployment.findMany({
      where: { id: { in: ids((env) => env.acceptedDeploymentId) } },
      select: { id: true, finishedAt: true },
    }),
  ]);
  return buildGrid({
    services,
    environments,
    latest,
    awaiting,
    builds,
    revisions: new Map(accepted.map((row) => [row.id, row.revision])),
    finished: new Map(accepting.map((row) => [row.id, row.finishedAt])),
  });
}
