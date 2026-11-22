import type {
  CommitBuild,
  CommitEnvironment,
  CommitListQuery,
  CommitService,
  CommitStatus,
  CommitSummary,
} from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { index } from "#infrastructure/delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";
import { decodeCursor, page, PAGE_SIZE } from "./cursor.ts";
import { buildStatus } from "./status.ts";
import { promotionOrder } from "./topology.ts";
import { buildView, serviceSummary } from "./views.ts";
import {
  carryingCommits,
  pipelineCarriers,
  supersedingReleases,
  type Carrier,
} from "./carried.ts";
import {
  blockingEnvironments,
  commitVerdict,
  environmentState,
  groupByEnvironment,
  isLive,
  mergeByService,
  serviceVerdict,
  verdictRank,
  type ChangeFacts,
} from "./commit-status.ts";
import {
  DEPLOYMENT_FIELDS,
  SET_FIELDS,
  carriersOf,
  environmentRecord,
  setFacts,
} from "./commit-environments.ts";

const SHA = /^[0-9a-f]{7,40}$/iu;

type Read = { status: CommitStatus };

/** Builds of catalog services only, as a commit read counts them. */
const catalogBuilds = <T extends { serviceId: string }>(rows: T[]) =>
  rows.filter((row) => index.byId(row.serviceId)?.id === row.serviceId);

/**
 * The builds whose releases carry failed commits' changes: each carried
 * failure's release, and every build of a commit that carries a whole
 * failed pipeline. A carrying pipeline's build that built new artifacts but
 * composed nothing, because a newer build already stood for its service,
 * ships in that newer build's release, so `superseding` maps it there and
 * that build is read too.
 */
async function carryingBuilds(
  database: Database,
  carried: ReadonlyMap<string, Carrier>,
  pipelineCarrier: ReadonlyMap<string, string>,
) {
  const rows = catalogBuilds(
    await database.build.findMany({
      where: {
        OR: [
          {
            id: {
              in: [...carried.values()].flatMap((entry) =>
                entry.releaseBuildId === null ? [] : [entry.releaseBuildId],
              ),
            },
          },
          {
            sourceRevision: { in: [...new Set(pipelineCarrier.values())] },
            sourceKind: "ci",
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  );
  const carrierShas = new Set(pipelineCarrier.values());
  const superseding = await supersedingReleases(
    database,
    rows
      .filter(
        (row) =>
          carrierShas.has(row.sourceRevision) &&
          buildStatus(row.status) === "succeeded",
      )
      .map((row) => row.id),
  );
  const seen = new Set(rows.map((row) => row.id));
  const missing = [...new Set(superseding.values())].filter(
    (id) => !seen.has(id),
  );
  const releases =
    missing.length === 0
      ? []
      : await database.build.findMany({ where: { id: { in: missing } } });
  return { carrierBuilds: [...rows, ...releases], superseding };
}

/** A build of a commit, named by its service's catalog title. */
function commitBuild(row: Parameters<typeof buildView>[0]): CommitBuild {
  return {
    ...buildView(row),
    serviceTitle: serviceSummary(row.serviceId).title,
  };
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
  const pipelineCarrier = pipelineCarriers(shas, builds, carried);
  const { carrierBuilds, superseding } = await carryingBuilds(
    database,
    carried,
    pipelineCarrier,
  );
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
  // A service no environment tracks has nowhere to be released, so a
  // carried failure of it, or its release, decides nothing.
  const tracked = new Set(environments.map((row) => row.serviceId));

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

  /**
   * Where a carrying pipeline's build stands: its own release, or, when a
   * newer build already stood for its service, that build's release.
   */
  const carrierStanding = (
    row: (typeof rows)[number],
  ): CommitService | null => {
    const own = standing(row);
    if (own !== null) return { ...own, includedIn: row.sourceRevision };
    const releaseId = superseding.get(row.id);
    const release = carrierBuilds.find((entry) => entry.id === releaseId);
    const entry = release === undefined ? null : standing(release);
    return release === undefined || entry === null
      ? null
      : { ...entry, includedIn: release.sourceRevision };
  };

  return shas.map((sha): Read => {
    const own = builds.filter((row) => row.sourceRevision === sha);
    const built: CommitService[] = [];
    let unchangedCount = 0;
    for (const build of own) {
      if (buildStatus(build.status) !== "succeeded") continue;
      const entry = standing(build);
      if (entry === null) unchangedCount += 1;
      else built.push(entry);
    }
    const failedBuilds = own
      .filter((row) => buildStatus(row.status) === "failed")
      .map((row) => commitBuild(row));
    const carriedFailures = failedBuilds.flatMap((build) => {
      const carrier = carried.get(build.id);
      return carrier === undefined
        ? []
        : [
            {
              buildId: build.id,
              includedIn: carrier.includedIn,
              ...(build.serviceTitle === undefined
                ? {}
                : { serviceTitle: build.serviceTitle }),
            },
          ];
    });
    // A carried failure's change ships in the first later release of the
    // service, so that release's standing is this commit's for the service.
    // While no later passing build has a release, it is not released.
    const carriedEntries: CommitService[] = [];
    for (const build of failedBuilds) {
      const carrier = carried.get(build.id);
      if (carrier === undefined || !tracked.has(build.serviceId)) continue;
      const row = carrierBuilds.find(
        (entry) => entry.id === carrier.releaseBuildId,
      );
      const entry = row === undefined ? null : standing(row);
      carriedEntries.push(
        row === undefined || entry === null
          ? {
              service: serviceSummary(build.serviceId),
              build,
              versionSet: null,
              verdict: "waiting",
              environments: [],
              includedIn: carrier.includedIn,
            }
          : { ...entry, includedIn: row.sourceRevision },
      );
    }
    // A commit whose whole pipeline failed ships everything it changed in
    // the releases of the first later commit whose pipeline passed.
    const pipelineSha = pipelineCarrier.get(sha);
    const builtHere = new Set(own.map((row) => row.serviceId));
    const pipelineEntries = carrierBuilds.flatMap((row) => {
      if (
        row.sourceRevision !== pipelineSha ||
        builtHere.has(row.serviceId) ||
        !tracked.has(row.serviceId) ||
        buildStatus(row.status) !== "succeeded"
      )
        return [];
      const entry = carrierStanding(row);
      return entry === null ? [] : [entry];
    });
    const changed = mergeByService([
      ...built,
      ...carriedEntries,
      ...pipelineEntries,
    ]).toSorted(
      (left, right) =>
        verdictRank(left.verdict) - verdictRank(right.verdict) ||
        left.service.title.localeCompare(right.service.title),
    );
    const pendingBuilds = own
      .filter((row) => buildStatus(row.status) === "pending")
      .map((row) => commitBuild(row));
    const blockers = blockingEnvironments(changed);
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
        blocker: blockers[0] ?? null,
        blockers,
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
    failedServices: [
      ...new Set(
        status.failedBuilds
          .filter(
            (build) =>
              !(status.carriedFailures ?? []).some(
                (entry) => entry.buildId === build.id,
              ),
          )
          .map((build) => build.serviceTitle ?? build.serviceId),
      ),
    ],
    carriedFailures: status.carriedFailures ?? [],
    blocker: status.blocker,
    blockers: status.blockers ?? [],
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
