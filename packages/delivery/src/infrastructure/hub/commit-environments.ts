import { DeploymentStatusSchema } from "#shared/contract.ts";
import type { CommitEnvironmentRelease } from "#shared/hub/commit-release-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { AWAITING_PLAN_DECISION } from "#infrastructure/selection/views.ts";
import { advancesAcceptance } from "#infrastructure/execution/ownership.ts";
import { latestDeployments } from "./attention.ts";
import {
  carries,
  decidingDeployment,
  type ChangeFacts,
  type SetFacts,
} from "./commit-status.ts";

// What the environments a commit read touches hold, read by set: the
// deployments and set revisions the commit rules compare a change against.

export type DeploymentRow = Pick<
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

export const DEPLOYMENT_FIELDS = {
  id: true,
  environmentId: true,
  versionSetRevisionId: true,
  platformSourceBuildId: true,
  status: true,
  recoveryRequired: true,
  kind: true,
  createdAt: true,
} as const;

export const SET_FIELDS = {
  id: true,
  revision: true,
  lineage: true,
  orderMajor: true,
  orderMinor: true,
} as const;

/** A set revision as the commit rules read it; a manual hotfix has no order key. */
export function setFacts(row: {
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

/**
 * A version-set release as one environment saw it: its own newest
 * deployment there, which `carriersOf` may not have chosen when a newer
 * release's deployment carries the change, and the accepted release's
 * revision when that newer release carries it. A platform change has none.
 */
export function releaseIn(
  versionSet: { id: string; revision: number } | undefined,
  environmentId: string,
  own: readonly DeploymentRow[],
  superseding: { state: string; accepted: SetFacts | null },
): CommitEnvironmentRelease | undefined {
  if (versionSet === undefined) return undefined;
  const newest = own
    .filter(
      (row) =>
        row.environmentId === environmentId &&
        row.versionSetRevisionId === versionSet.id,
    )
    .toSorted(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )
    .at(0);
  return {
    revision: versionSet.revision,
    status:
      newest === undefined ? null : DeploymentStatusSchema.parse(newest.status),
    ...(superseding.state === "superseded" && superseding.accepted !== null
      ? { supersededBy: superseding.accepted.revision }
      : {}),
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
export async function environmentRecord(
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
export function carriersOf(
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
