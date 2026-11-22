import { DeploymentStatusSchema } from "#shared/contract.ts";
import type {
  CommitEnvironment,
  CommitListQuery,
  CommitService,
  CommitStatus,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { index } from "#infrastructure/delivery-data.ts";
import { AWAITING_PLAN_DECISION } from "#infrastructure/selection/views.ts";
import { advancesAcceptance } from "#infrastructure/execution/ownership.ts";
import { DeliveryError } from "#domain/error.ts";
import { decodeCursor, page, PAGE_SIZE } from "./cursor.ts";
import { buildStatus } from "./status.ts";
import { promotionOrder } from "./topology.ts";
import { buildView, serviceSummary } from "./views.ts";
import { latestDeployments } from "./attention.ts";
import { carryingCommits } from "./carried.ts";
import {
  blockingEnvironment,
  carries,
  commitVerdict,
  decidingDeployment,
  environmentState,
  groupByEnvironment,
  isLive,
  serviceVerdict,
  verdictRank,
  type ChangeFacts,
  type SetFacts,
} from "./commit-status.ts";

const SHA = /^[0-9a-f]{7,40}$/iu;

type Read = { status: CommitStatus };

type DeploymentRow = Pick<
  Prisma.DeploymentGetPayload<object>,
  | "id"
  | "environmentId"
  | "versionSetRevisionId"
  | "platformSourceBuildId"
  | "status"
  | "recoveryRequired"
  | "kind"
  | "createdAt"
>;

const DEPLOYMENT_FIELDS = {
  id: true,
  environmentId: true,
  versionSetRevisionId: true,
  platformSourceBuildId: true,
  status: true,
  recoveryRequired: true,
  kind: true,
  createdAt: true,
} as const;

const SET_FIELDS = {
  id: true,
  revision: true,
  lineage: true,
  orderMajor: true,
  orderMinor: true,
} as const;

/** A set revision as the commit rules read it; a manual hotfix has no order key. */
function setFacts(row: {
  revision: number;
  lineage: string;
  orderMajor: number | null;
  orderMinor: number | null;
}): SetFacts {
  return {
    revision: row.revision,
    lineage: row.lineage,
    order:
      row.orderMajor === null || row.orderMinor === null
        ? null
        : { major: row.orderMajor, minor: row.orderMinor },
  };
}

/** Deployments not yet finished: queued, running or waiting for a decision. */
const OPEN_STATUSES = ["queued", "running", "awaiting_approval"];

/**
 * What every environment the commits touch holds: its newest deployment of
 * any change, its unfinished deployments, which of those wait on a saved
 * plan, and the set revision behind each of them and each accepted
 * selection. Every read is by set, never per environment.
 */
async function environmentRecord(
  database: Database,
  environments: readonly {
    id: string;
    acceptedVersionSetRevisionId: string | null;
  }[],
) {
  const ids = environments.map((row) => row.id);
  const [newestAll, open, planned] = await Promise.all([
    latestDeployments(database),
    database.deployment.findMany({
      where: { environmentId: { in: ids }, status: { in: OPEN_STATUSES } },
      select: DEPLOYMENT_FIELDS,
    }),
    database.deployment.findMany({
      where: { AND: [{ environmentId: { in: ids } }, AWAITING_PLAN_DECISION] },
      select: { id: true },
    }),
  ]);
  const newest = new Map(
    ids.flatMap((id) => {
      const row = newestAll.get(id);
      return row === undefined ? [] : [[id, row] as const];
    }),
  );
  const sets = await database.versionSet.findMany({
    where: {
      id: {
        in: [
          ...environments.flatMap((row) =>
            row.acceptedVersionSetRevisionId === null
              ? []
              : [row.acceptedVersionSetRevisionId],
          ),
          ...[...newest.values(), ...open].map(
            (row) => row.versionSetRevisionId,
          ),
        ],
      },
    },
    select: SET_FIELDS,
  });
  return {
    newest,
    open,
    awaitingPlan: new Set(planned.map((row) => row.id)),
    sets: new Map<string, SetFacts>(sets.map((row) => [row.id, setFacts(row)])),
  };
}

type EnvironmentRecord = Awaited<ReturnType<typeof environmentRecord>>;

/**
 * The deployments that would deliver a change to one environment: those of
 * the change itself, and for a version set the environment's newest and
 * unfinished deployments of a set revision that includes it.
 */
function carriersOf(
  change: ChangeFacts,
  environmentId: string,
  own: readonly DeploymentRow[],
  record: EnvironmentRecord,
) {
  const carriers = new Map(
    own
      .filter((row) => row.environmentId === environmentId)
      .map((row) => [row.id, row]),
  );
  if (change !== null) {
    const newest = record.newest.get(environmentId);
    for (const row of [
      ...(newest === undefined ? [] : [newest]),
      ...record.open.filter((entry) => entry.environmentId === environmentId),
    ]) {
      const set = record.sets.get(row.versionSetRevisionId);
      if (set === undefined)
        throw new Error(`Deployment ${row.id} names a set revision not read`);
      if (carries(change, set)) carriers.set(row.id, row);
    }
  }
  return decidingDeployment(
    [...carriers.values()].map((row) => ({
      ...row,
      // A deployment waiting on a saved-plan decision is waiting for approval.
      status: record.awaitingPlan.has(row.id)
        ? ("awaiting_approval" as const)
        : DeploymentStatusSchema.parse(row.status),
      delivers: advancesAcceptance(row.kind),
    })),
  );
}

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
  const carried = await carryingCommits(
    database,
    builds
      .filter((row) => buildStatus(row.status) === "failed")
      .map((row) => row.id),
  );
  // The passing builds that carry a failed one: their releases decide
  // whether the failed commit's change is live yet.
  const carrierBuilds = await database.build.findMany({
    where: {
      id: { in: [...carried.values()].map((entry) => entry.carrierBuildId) },
    },
  });
  const buildIds = [...builds, ...carrierBuilds].map((row) => row.id);
  const versionSets = await database.versionSet.findMany({
    where: { qualifiedBuildId: { in: buildIds } },
    select: { ...SET_FIELDS, serviceId: true, qualifiedBuildId: true },
  });
  const versionSetByBuild = new Map(
    versionSets.flatMap((row) =>
      row.qualifiedBuildId === null ? [] : [[row.qualifiedBuildId, row]],
    ),
  );
  const serviceIds = [
    ...new Set([...builds, ...carrierBuilds].map((row) => row.serviceId)),
  ];
  const [sourceCommits, deployments, environments] = await Promise.all([
    database.sourceCommit.findMany({
      where: { sourceRevision: { in: shas } },
      select: { sourceRevision: true, title: true, author: true },
    }),
    database.deployment.findMany({
      where: {
        OR: [
          { platformSourceBuildId: { in: buildIds } },
          { versionSetRevisionId: { in: versionSets.map((row) => row.id) } },
        ],
      },
      select: DEPLOYMENT_FIELDS,
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
  const record = await environmentRecord(database, environments);
  const sourceBySha = new Map(
    sourceCommits.map((row) => [row.sourceRevision, row]),
  );

  /** Where a passing build's change stands; null when it changed nothing. */
  const standing = (build: (typeof rows)[number]): CommitService | null => {
    const versionSet = versionSetByBuild.get(build.id);
    const linked = deployments.filter(
      (row) =>
        row.platformSourceBuildId === build.id ||
        row.versionSetRevisionId === versionSet?.id,
    );
    if (versionSet === undefined && linked.length === 0) return null;
    const change: ChangeFacts =
      versionSet === undefined ? null : setFacts(versionSet);
    const candidates = environments.filter(
      (row) =>
        row.serviceId === build.serviceId &&
        (versionSet !== undefined ||
          linked.some((entry) => entry.environmentId === row.id)),
    );
    const live = new Set<string>();
    const states: CommitEnvironment[] = promotionOrder(candidates).map(
      (environment) => {
        const accepted =
          environment.acceptedVersionSetRevisionId === null
            ? null
            : record.sets.get(environment.acceptedVersionSetRevisionId);
        if (accepted === undefined)
          throw new Error(
            `Environment ${environment.id} accepts a set revision not read`,
          );
        const deployment = carriersOf(change, environment.id, linked, record);
        const state = environmentState({
          change,
          environment: {
            id: environment.id,
            automatic: environment.automatic,
            promotionSourceEnvironmentId:
              environment.promotionSourceEnvironmentId,
            accepted,
            locked:
              record.newest.get(environment.id)?.recoveryRequired === true,
          },
          deployment,
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
    return {
      service: serviceSummary(build.serviceId),
      build: buildView(build),
      versionSet:
        versionSet === undefined
          ? null
          : { id: versionSet.id, revision: versionSet.revision },
      verdict: serviceVerdict(
        "succeeded",
        states.map((entry) => entry.state),
      ),
      environments: states,
    };
  };

  return shas.map((sha): Read => {
    const own = builds.filter((row) => row.sourceRevision === sha);
    const changed: CommitService[] = [];
    let unchangedCount = 0;
    for (const build of own) {
      if (buildStatus(build.status) !== "succeeded") continue;
      const entry = standing(build);
      if (entry === null) unchangedCount += 1;
      else changed.push(entry);
    }
    const failedBuilds = own
      .filter((row) => buildStatus(row.status) === "failed")
      .map((row) => buildView(row));
    const carriedFailures = failedBuilds.flatMap((build) => {
      const carrier = carried.get(build.id);
      return carrier === undefined
        ? []
        : [{ buildId: build.id, includedIn: carrier.includedIn }];
    });
    // A carried failure's change ships in the carrying build's release, so
    // that release's standing is this commit's for the service.
    for (const build of failedBuilds) {
      const carrier = carried.get(build.id);
      const row = carrierBuilds.find(
        (entry) => entry.id === carrier?.carrierBuildId,
      );
      const entry = row === undefined ? null : standing(row);
      if (entry !== null && carrier !== undefined)
        changed.push({ ...entry, includedIn: carrier.includedIn });
    }
    changed.sort(
      (left, right) =>
        verdictRank(left.verdict) - verdictRank(right.verdict) ||
        left.service.title.localeCompare(right.service.title),
    );
    const pendingBuilds = own
      .filter((row) => buildStatus(row.status) === "pending")
      .map((row) => buildView(row));
    return {
      status: {
        sha,
        title: sourceBySha.get(sha)?.title ?? null,
        author: sourceBySha.get(sha)?.author ?? null,
        verdict: commitVerdict({
          changed: changed.map((entry) => entry.verdict),
          failed: failedBuilds.length,
          carried: carriedFailures.length,
          pending: pendingBuilds.length,
          builds: own.length,
        }),
        buildId: own[0]?.id ?? null,
        environments: groupByEnvironment(changed),
        seenAt: own[0]?.createdAt.toISOString() ?? null,
        changed,
        unchangedCount,
        failedBuilds,
        carriedFailures,
        pendingBuilds,
        blocker: blockingEnvironment(changed),
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

/** One commit's row in the list: its one-line answer and what is stuck. */
function summary(status: CommitStatus, firstSeenAt: Date): CommitSummary {
  if (status.buildId === null)
    throw new Error(`Listed commit ${status.sha} has no build`);
  return {
    sha: status.sha,
    title: status.title,
    author: status.author,
    verdict: status.verdict,
    seenAt: firstSeenAt.toISOString(),
    buildId: status.buildId,
    environments: status.environments.map(
      ({ members: _members, ...group }) => group,
    ),
    changedCount: status.changed.length,
    liveCount: status.changed.filter((entry) => entry.verdict === "deployed")
      .length,
    failedBuildCount: status.failedBuilds.length,
    carriedFailures: status.carriedFailures ?? [],
    blocker: status.blocker,
  };
}

/**
 * One page of the commits CI has published, newest first, each with its
 * one-line answer. A commit's position is the first time Delivery heard of it:
 * its oldest CI build. Unlike its newest build, that never moves while a
 * pipeline keeps registering builds, so a page does not reshuffle under a
 * reader. Only catalog services count, as in a commit read.
 */
export async function commitPage(database: Database, query: CommitListQuery) {
  const cursor = decodeCursor(query.cursor);
  const groups = await database.build.groupBy({
    by: ["sourceRevision"],
    where: {
      sourceKind: "ci",
      serviceId: { in: index.services.map((service) => service.id) },
    },
    _min: { createdAt: true },
    ...(cursor === null
      ? {}
      : {
          having: {
            OR: [
              { createdAt: { _min: { lt: cursor.t } } },
              {
                createdAt: { _min: { equals: cursor.t } },
                sourceRevision: { lt: cursor.id },
              },
            ],
          },
        }),
    orderBy: [{ _min: { createdAt: "desc" } }, { sourceRevision: "desc" }],
    take: PAGE_SIZE + 1,
  });
  const selected = page(
    groups.map((row) => {
      if (row._min.createdAt === null)
        throw new Error(`Commit ${row.sourceRevision} has no first build`);
      return { id: row.sourceRevision, firstSeenAt: row._min.createdAt };
    }),
    PAGE_SIZE,
    (row) => row.firstSeenAt,
  );
  const reads = await readCommits(
    database,
    selected.items.map((row) => row.id),
  );
  return {
    items: selected.items.map((row, position) => {
      const read = reads[position];
      if (read?.status.sha !== row.id)
        throw new Error("A commit read returns one entry per sha, in order");
      return summary(read.status, row.firstSeenAt);
    }),
    nextCursor: selected.nextCursor,
  };
}
