import { ApprovalPolicySchema } from "#shared/contract.ts";
import type { HubOverview, HubService } from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { decisionStatus } from "./attention.ts";
import { gridAttention, listedRecord, readGridRecord } from "./grid.ts";
import { toolLinks } from "./links.ts";
import { latestExecutions } from "./executions.ts";
import { promotionOrder } from "./topology.ts";
import { activityEntry, buildView, serviceSummary } from "./views.ts";

/**
 * Every delivered service with its newest build and environment states. The
 * service set and the attention list come from the same read and the same
 * rules as the Overview grid (`listedRecord`, `gridAttention`), so the two
 * pages list the same services and the same items.
 */
export async function hubOverview(database: Database): Promise<HubOverview> {
  const [record, audit] = await Promise.all([
    readGridRecord(database),
    database.audit.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 12,
    }),
  ]);
  const builds = record.builds;
  const { services: listed, environments } = listedRecord(record);
  // A listed service with an environment or a build; others have no pipeline.
  const serviceIds = [
    ...new Set([
      ...environments.map((env) => env.serviceId),
      ...[...builds.keys()].filter((id) => listed.has(id)),
    ]),
  ];
  const executions = await latestExecutions(database, serviceIds, builds);
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
            observedAt: env.observedAt?.toISOString() ?? null,
            approvalRequired:
              ApprovalPolicySchema.parse(env.approvalPolicy) === "required",
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
