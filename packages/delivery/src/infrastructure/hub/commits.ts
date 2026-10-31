import { DeploymentStatusSchema } from "#shared/contract.ts";
import type {
  CommitEnvironment,
  CommitService,
  CommitStatus,
  CommitSummary,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { index } from "#infrastructure/delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";
import { buildStatus } from "./status.ts";
import { promotionOrder } from "./topology.ts";
import { buildView, serviceSummary } from "./views.ts";
import { latestPerEnvironment } from "./executions.ts";
import {
  environmentState,
  groupByEnvironment,
  isLive,
  rollUp,
  serviceVerdict,
  verdictRank,
} from "./commit-status.ts";

const SHA = /^[0-9a-f]{7,40}$/iu;
const RECENT_COMMITS = 15;

type Read = { status: CommitStatus };

/**
 * Where each commit stands. One build exists per service per commit, but only a
 * build that produced a version set (or a platform deployment) changed
 * anything; every other build is "nothing to deploy". Reads are batched so a
 * list of commits costs a handful of queries, not one per service.
 */
async function readCommits(
  database: Database,
  shas: string[],
): Promise<Read[]> {
  if (shas.length === 0) return [];
  const rows = await database.build.findMany({
    where: { sourceRevision: { in: shas } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const builds = rows.filter(
    (row) => index.byId(row.serviceId)?.id === row.serviceId,
  );
  const buildIds = builds.map((row) => row.id);
  const versionSets = await database.versionSet.findMany({
    where: { qualifiedBuildId: { in: buildIds } },
    select: {
      id: true,
      serviceId: true,
      revision: true,
      lineage: true,
      qualifiedBuildId: true,
    },
  });
  const versionSetByBuild = new Map(
    versionSets.flatMap((row) =>
      row.qualifiedBuildId === null ? [] : [[row.qualifiedBuildId, row]],
    ),
  );
  const serviceIds = [...new Set(builds.map((row) => row.serviceId))];
  const [deployments, environments] = await Promise.all([
    database.deployment.findMany({
      where: {
        OR: [
          { platformSourceBuildId: { in: buildIds } },
          { versionSetRevisionId: { in: versionSets.map((row) => row.id) } },
        ],
      },
      select: {
        id: true,
        environmentId: true,
        versionSetRevisionId: true,
        platformSourceBuildId: true,
        status: true,
        recoveryRequired: true,
        createdAt: true,
      },
    }),
    database.environment.findMany({
      where: { lifecycle: "active", serviceId: { in: serviceIds } },
      select: {
        id: true,
        name: true,
        serviceId: true,
        automatic: true,
        promotionSourceEnvironmentId: true,
        acceptedVersionSetRevisionId: true,
      },
    }),
  ]);
  const acceptedSets = await database.versionSet.findMany({
    where: {
      id: {
        in: environments.flatMap((row) =>
          row.acceptedVersionSetRevisionId === null
            ? []
            : [row.acceptedVersionSetRevisionId],
        ),
      },
    },
    select: { id: true, revision: true, lineage: true },
  });
  const acceptedById = new Map(acceptedSets.map((row) => [row.id, row]));

  return shas.map((sha): Read => {
    const own = builds.filter((row) => row.sourceRevision === sha);
    const changed: CommitService[] = [];
    let unchangedCount = 0;
    for (const build of own) {
      const status = buildStatus(build.status);
      const versionSet = versionSetByBuild.get(build.id);
      const linked = deployments.filter(
        (row) =>
          row.platformSourceBuildId === build.id ||
          row.versionSetRevisionId === versionSet?.id,
      );
      if (status !== "succeeded") continue;
      if (versionSet === undefined && linked.length === 0) {
        unchangedCount += 1;
        continue;
      }
      const newest = new Map(
        latestPerEnvironment(linked).map((row) => [row.environmentId, row]),
      );
      const candidates = environments.filter(
        (row) =>
          row.serviceId === build.serviceId &&
          (versionSet !== undefined || newest.has(row.id)),
      );
      const live = new Set<string>();
      const states: CommitEnvironment[] = promotionOrder(candidates).map(
        (environment) => {
          const accepted =
            environment.acceptedVersionSetRevisionId === null
              ? undefined
              : acceptedById.get(environment.acceptedVersionSetRevisionId);
          const deployment = newest.get(environment.id);
          const state = environmentState({
            change:
              versionSet === undefined
                ? null
                : {
                    revision: versionSet.revision,
                    lineage: versionSet.lineage,
                  },
            environment: {
              id: environment.id,
              automatic: environment.automatic,
              promotionSourceEnvironmentId:
                environment.promotionSourceEnvironmentId,
              accepted:
                accepted === undefined
                  ? null
                  : { revision: accepted.revision, lineage: accepted.lineage },
            },
            deployment:
              deployment === undefined
                ? null
                : {
                    status: DeploymentStatusSchema.parse(deployment.status),
                    recoveryRequired: deployment.recoveryRequired,
                  },
            sourceLive:
              environment.promotionSourceEnvironmentId !== null &&
              live.has(environment.promotionSourceEnvironmentId),
          });
          if (isLive(state)) live.add(environment.id);
          return {
            environmentId: environment.id,
            name: environment.name,
            state,
            deploymentId: deployment?.id ?? null,
          };
        },
      );
      changed.push({
        service: serviceSummary(build.serviceId),
        build: buildView(build),
        versionSet:
          versionSet === undefined
            ? null
            : { id: versionSet.id, revision: versionSet.revision },
        verdict: serviceVerdict(
          status,
          states.map((entry) => entry.state),
        ),
        environments: states,
      });
    }
    changed.sort(
      (left, right) =>
        verdictRank(left.verdict) - verdictRank(right.verdict) ||
        left.service.title.localeCompare(right.service.title),
    );
    const failedBuilds = own
      .filter((row) => buildStatus(row.status) === "failed")
      .map((row) => buildView(row));
    const pendingBuilds = own
      .filter((row) => buildStatus(row.status) === "pending")
      .map((row) => buildView(row));
    const parts: CommitVerdict[] = changed.map((entry) => entry.verdict);
    if (failedBuilds.length > 0) parts.push("build_failed");
    if (pendingBuilds.length > 0) parts.push("building");
    if (own.length > 0 && parts.length === 0) parts.push("nothing_to_deploy");
    return {
      status: {
        sha,
        verdict: rollUp(parts),
        buildId: own[0]?.id ?? null,
        environments: groupByEnvironment(changed),
        seenAt: own[0]?.createdAt.toISOString() ?? null,
        changed,
        unchangedCount,
        failedBuilds,
        pendingBuilds,
      },
    };
  });
}

async function resolveSha(database: Database, input: string) {
  if (!SHA.test(input))
    throw new DeliveryError(
      "INVALID",
      "Give at least 7 hex digits of a commit",
    );
  const sha = input.toLowerCase();
  if (sha.length === 40) return sha;
  const matches = await database.build.findMany({
    where: { sourceRevision: { startsWith: sha } },
    distinct: ["sourceRevision"],
    select: { sourceRevision: true },
    take: 2,
  });
  if (matches.length > 1)
    throw new DeliveryError("INVALID", "That commit prefix is ambiguous");
  return matches[0]?.sourceRevision ?? sha;
}

/** One commit, from a full sha or an unambiguous prefix of at least 7 digits. */
export async function commitStatus(
  database: Database,
  input: string,
): Promise<CommitStatus> {
  const [read] = await readCommits(database, [
    await resolveSha(database, input),
  ]);
  if (read === undefined) throw new Error("A commit read returns one entry");
  return read.status;
}

/** The newest commits Delivery has heard of, each with its one-line answer. */
export async function recentCommits(
  database: Database,
  limit = RECENT_COMMITS,
): Promise<CommitSummary[]> {
  const groups = await database.build.groupBy({
    by: ["sourceRevision"],
    where: { sourceKind: "ci" },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: limit,
  });
  const reads = await readCommits(
    database,
    groups.map((row) => row.sourceRevision),
  );
  return reads.flatMap((read): CommitSummary[] => {
    const { status } = read;
    if (status.buildId === null) return [];
    const stuck = status.changed.find(
      (entry) =>
        entry.verdict !== "deployed" && entry.verdict !== "nothing_to_deploy",
    );
    const stuckEnvironment = stuck?.environments.find(
      (entry) => !isLive(entry.state),
    );
    return [
      {
        sha: status.sha,
        verdict: status.verdict,
        seenAt: status.seenAt,
        buildId: status.buildId,
        environments: status.environments.map(
          ({ members: _members, ...group }) => group,
        ),
        changedCount: status.changed.length,
        liveCount: status.changed.filter(
          (entry) => entry.verdict === "deployed",
        ).length,
        blocker:
          stuck === undefined
            ? null
            : {
                service: stuck.service.title,
                environment: stuckEnvironment?.name ?? null,
                state: stuck.verdict,
              },
      },
    ];
  });
}
