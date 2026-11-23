import type { HubOverview, HubService } from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { environment as readEnvironment } from "#infrastructure/delivery-data.ts";
import { decisionStatus, latestBuilds } from "./attention.ts";
import { gridAttention, listedRecord, readGridRecord } from "./grid.ts";
import { toolLinks } from "./links.ts";
import { latestExecution } from "./executions.ts";
import { promotionOrder } from "./topology.ts";
import { activityEntry, buildView, serviceSummary } from "./views.ts";

/**
 * Every delivered service with its newest build and environment states. The
 * service set and the attention list come from the same read and the same
 * rules as the Overview grid (`listedRecord`, `gridAttention`), so the two
 * pages list the same services and the same items.
 */
export async function hubOverview(database: Database): Promise<HubOverview> {
  const [record, builds, audit] = await Promise.all([
    readGridRecord(database),
    latestBuilds(database),
    database.audit.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 12,
    }),
  ]);
  const { services: listed, environments: rows } = listedRecord(record);
  const environments = await Promise.all(
    rows.map((row) => readEnvironment(database, row.id)),
  );
  // A listed service with an environment or a build; others have no pipeline.
  const serviceIds = [
    ...new Set([
      ...environments.map((env) => env.serviceId),
      ...[...builds.keys()].filter((id) => listed.has(id)),
    ]),
  ];
  const executions = new Map(
    await Promise.all(
      serviceIds.map(
        async (serviceId) =>
          [serviceId, await latestExecution(database, serviceId)] as const,
      ),
    ),
  );
  const revisionOf = (setId: string | null) =>
    setId === null ? null : (record.revisions.get(setId) ?? null);
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
          const deployment = record.latest.get(env.id);
          return {
            id: env.id,
            name: env.name,
            status:
              deployment === undefined
                ? "not_started"
                : decisionStatus(deployment, record.awaiting),
            recoveryRequired: deployment?.recoveryRequired ?? false,
            acceptedRevision: revisionOf(env.acceptedVersionSetRevisionId),
            observedAt: env.observedAt,
            approvalRequired: env.approvalPolicy === "required",
            activeDeploymentId: env.activeDeploymentId,
            lastDeploymentAt:
              deployment === undefined
                ? null
                : (deployment.finishedAt ?? deployment.createdAt).toISOString(),
          };
        }),
      };
    })
    .toSorted((left, right) => left.title.localeCompare(right.title));
  return {
    services,
    attention: gridAttention(record),
    activity: audit.map((row) => activityEntry(row)),
    tools: toolLinks(),
  };
}
