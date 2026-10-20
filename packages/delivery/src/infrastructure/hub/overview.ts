import { z } from "zod";
import { DeploymentStatusSchema } from "#shared/contract.ts";
import type {
  Attention,
  HubOverview,
  HubService,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  environment as readEnvironment,
  index,
} from "#infrastructure/delivery-data.ts";
import { toolLinks } from "./links.ts";
import { latestExecution } from "./executions.ts";
import { promotionOrder } from "./topology.ts";
import { activityEntry, buildView, serviceSummary } from "./views.ts";

type DeploymentRow = Prisma.DeploymentGetPayload<object>;
const IdRowsSchema = z.array(z.object({ id: z.string() }));

async function latestDeployments(database: Database) {
  const rows = IdRowsSchema.parse(
    await database.$queryRaw`
    SELECT DISTINCT ON ("environmentId") "id" FROM "Deployment"
    ORDER BY "environmentId", "createdAt" DESC, "id" DESC
  `,
  );
  const deployments = await database.deployment.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  return new Map(deployments.map((row) => [row.environmentId, row]));
}

async function latestBuilds(database: Database) {
  const rows = IdRowsSchema.parse(
    await database.$queryRaw`
    SELECT DISTINCT ON ("serviceId") "id" FROM "Build"
    ORDER BY "serviceId", "createdAt" DESC, "id" DESC
  `,
  );
  const builds = await database.build.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  return new Map(builds.map((row) => [row.serviceId, row]));
}

function attention(
  services: HubService[],
  latest: Map<string, DeploymentRow>,
  awaiting: DeploymentRow[],
): Attention[] {
  const items: Attention[] = awaiting.map((deployment) => ({
    kind: "approval",
    title: `${deployment.environmentId} awaits approval`,
    detail: `${deployment.kind} requested by ${deployment.requestedBy}`,
    at: deployment.createdAt.toISOString(),
    target: { kind: "deployment", id: deployment.id },
  }));
  for (const deployment of latest.values()) {
    if (deployment.recoveryRequired)
      items.push({
        kind: "recovery",
        title: `${deployment.environmentId} requires recovery`,
        detail: deployment.message ?? "The target lock is quarantined",
        at: deployment.finishedAt?.toISOString() ?? null,
        target: { kind: "deployment", id: deployment.id },
      });
    else if (deployment.status === "failed")
      items.push({
        kind: "failed",
        title: `${deployment.environmentId} deployment failed`,
        detail: deployment.message ?? deployment.kind,
        at: deployment.finishedAt?.toISOString() ?? null,
        target: { kind: "deployment", id: deployment.id },
      });
  }
  for (const service of services)
    if (service.latestBuild?.status === "failed")
      items.push({
        kind: "build_failed",
        title: `${service.title} build failed qualification`,
        detail: service.latestBuild.qualificationReason ?? "CI did not pass",
        at: service.latestBuild.createdAt,
        target: { kind: "build", id: service.latestBuild.id },
      });
  return items.toSorted((left, right) =>
    (right.at ?? "").localeCompare(left.at ?? ""),
  );
}

/** Every delivered service with its newest build and environment states. */
export async function hubOverview(database: Database): Promise<HubOverview> {
  const [environmentRows, latest, builds, awaiting, audit] = await Promise.all([
    database.environment.findMany({ orderBy: { id: "asc" } }),
    latestDeployments(database),
    latestBuilds(database),
    database.deployment.findMany({
      where: { status: "awaiting_approval" },
      orderBy: { createdAt: "desc" },
    }),
    database.audit.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 12,
    }),
  ]);
  const environments = await Promise.all(
    environmentRows.map((row) => readEnvironment(database, row.id)),
  );
  const accepted = await database.versionSet.findMany({
    where: {
      id: {
        in: environments.flatMap((env) =>
          env.acceptedVersionSetRevisionId === null
            ? []
            : [env.acceptedVersionSetRevisionId],
        ),
      },
    },
  });
  const revisions = new Map(accepted.map((row) => [row.id, row.revision]));
  const serviceIds = [
    ...new Set([...environments.map((env) => env.serviceId), ...builds.keys()]),
  ].filter((id) => index.byId(id)?.id === id);
  const executions = new Map(
    await Promise.all(
      serviceIds.map(
        async (serviceId) =>
          [serviceId, await latestExecution(database, serviceId)] as const,
      ),
    ),
  );
  const services = serviceIds
    .map((serviceId): HubService => {
      const build = builds.get(serviceId);
      return {
        ...serviceSummary(serviceId),
        latestBuild: build === undefined ? null : buildView(build),
        latestExecution: executions.get(serviceId) ?? null,
        environments: promotionOrder(
          environments.filter((env) => env.serviceId === serviceId),
        ).map((env) => {
          const deployment = latest.get(env.id);
          return {
            id: env.id,
            name: env.name,
            status:
              deployment === undefined
                ? "not_started"
                : DeploymentStatusSchema.parse(deployment.status),
            acceptedRevision:
              env.acceptedVersionSetRevisionId === null
                ? null
                : (revisions.get(env.acceptedVersionSetRevisionId) ?? null),
            observedAt: env.observedAt,
            approvalRequired: env.approvalRequired,
            activeDeploymentId: env.activeDeploymentId,
          };
        }),
      };
    })
    .toSorted((left, right) => left.title.localeCompare(right.title));
  return {
    services,
    attention: attention(services, latest, awaiting),
    activity: audit.map((row) => activityEntry(row)),
    tools: toolLinks(),
  };
}
