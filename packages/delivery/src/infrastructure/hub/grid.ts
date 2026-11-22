import {
  CATALOG_CORE,
  type CatalogCore,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { ApprovalPolicySchema, LifecycleSchema } from "#shared/contract.ts";
import type {
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
  return {
    id: env.id,
    name: env.name,
    status:
      deployment === undefined
        ? "not_started"
        : decisionStatus(deployment, record.awaiting),
    request:
      deployment === undefined || deployment.id === env.acceptedDeploymentId
        ? null
        : {
            deploymentId: deployment.id,
            revision: revisionOf(
              record,
              deployment.versionSetRevisionId,
              `Deployment ${deployment.id} deploys a set revision the record does not hold`,
            ),
          },
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
      prior: record.prior,
      alarms: environments.flatMap((env): AlarmedRelease[] => {
        const at = alarmedAt(record, env);
        if (at === null) return [];
        if (env.acceptedVersionSetRevisionId === null)
          throw new Error(
            `Environment ${env.id} alarmed with nothing accepted`,
          );
        return [
          {
            environmentId: env.id,
            serviceId: env.serviceId,
            versionSetRevisionId: env.acceptedVersionSetRevisionId,
            alarmedAt: at,
          },
        ];
      }),
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
      revisions: record.revisions,
      now: record.now,
    }),
  };
}

/**
 * `GET /hub/grid`. Ten statements whatever the number of services: every row
 * is read by set, never per service or per environment, and no execution is
 * traced.
 */
export async function hubGrid(database: Database): Promise<HubGrid> {
  const [services, environments, latest, prior, builds, awaiting] =
    await Promise.all([
      database.service.findMany({ select: { id: true, lifecycle: true } }),
      database.environment.findMany(),
      latestDeployments(database),
      priorDeployments(database),
      latestBuilds(database),
      awaitingDecisions(database),
    ]);
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
  return buildGrid({
    services,
    environments,
    latest,
    prior,
    awaiting,
    builds,
    revisions: new Map(sets.map((row) => [row.id, row.revision])),
    accepting: new Map(accepting.map((row) => [row.id, row])),
    now: new Date(),
  });
}
