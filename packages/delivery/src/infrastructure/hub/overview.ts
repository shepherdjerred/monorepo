import type { HubOverview, HubService } from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  environment as readEnvironment,
  index,
} from "#infrastructure/delivery-data.ts";
import {
  attentionItems,
  awaitingDecisions,
  decisionStatus,
  deploymentSubjects,
  latestBuilds,
  latestDeployments,
  priorDeployments,
  statedDeployments,
} from "./attention.ts";
import { toolLinks } from "./links.ts";
import { latestExecution } from "./executions.ts";
import { promotionOrder } from "./topology.ts";
import { activityEntry, buildView, serviceSummary } from "./views.ts";

/** Every delivered service with its newest build and environment states. */
export async function hubOverview(database: Database): Promise<HubOverview> {
  const [environmentRows, newest, before, builds, awaiting, alarmed, audit] =
    await Promise.all([
      database.environment.findMany({ orderBy: { id: "asc" } }),
      latestDeployments(database),
      priorDeployments(database),
      latestBuilds(database),
      awaitingDecisions(database),
      // An accepted release a monitor alarm fired on.
      database.deployment.findMany({
        where: { monitorState: "alarmed", acceptedBy: { some: {} } },
        select: {
          environmentId: true,
          serviceId: true,
          versionSetRevisionId: true,
          monitorAlarmedAt: true,
        },
      }),
      database.audit.findMany({
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 12,
      }),
    ]);
  const { latest, prior } = await statedDeployments(database, newest, before);
  const environments = await Promise.all(
    environmentRows.map((row) => readEnvironment(database, row.id)),
  );
  // The accepted set revisions, and those the attention items name.
  const sets = await database.versionSet.findMany({
    where: {
      id: {
        in: [
          ...environments.flatMap((env) =>
            env.acceptedVersionSetRevisionId === null
              ? []
              : [env.acceptedVersionSetRevisionId],
          ),
          ...[...latest.values(), ...awaiting].map(
            (row) => row.versionSetRevisionId,
          ),
        ],
      },
    },
    select: { id: true, revision: true },
  });
  const revisions = new Map(sets.map((row) => [row.id, row.revision]));
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
                : decisionStatus(deployment, awaiting),
            recoveryRequired: deployment?.recoveryRequired ?? false,
            acceptedRevision:
              env.acceptedVersionSetRevisionId === null
                ? null
                : (revisions.get(env.acceptedVersionSetRevisionId) ?? null),
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
    attention: attentionItems({
      awaiting,
      latest: latest.values(),
      prior,
      alarms: alarmed.map((row) => {
        if (row.monitorAlarmedAt === null)
          throw new Error(
            `${row.environmentId}'s alarmed release has no alarm time`,
          );
        return { ...row, alarmedAt: row.monitorAlarmedAt };
      }),
      failedBuilds: services.flatMap((service) =>
        service.latestBuild?.status === "failed"
          ? [
              {
                id: service.latestBuild.id,
                serviceId: service.id,
                serviceTitle: service.title,
                reason: service.latestBuild.qualificationReason,
                at: service.latestBuild.createdAt,
              },
            ]
          : [],
      ),
      subject: deploymentSubjects(environments),
      revisions,
      now: new Date(),
    }),
    activity: audit.map((row) => activityEntry(row)),
    tools: toolLinks(),
  };
}
