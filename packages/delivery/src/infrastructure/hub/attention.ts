import { z } from "zod";
import { DeploymentStatusSchema } from "#shared/contract.ts";
import type { Attention } from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { AWAITING_PLAN_DECISION } from "#infrastructure/selection/views.ts";
import { servicePlacement } from "./views.ts";

type DeploymentRow = Prisma.DeploymentGetPayload<object>;
const IdRowsSchema = z.array(z.object({ id: z.string() }));
const PriorRowsSchema = z.array(
  z.object({
    id: z.string(),
    environmentId: z.string(),
    status: z.string(),
    message: z.string().nullable(),
  }),
);

/** What a failing streak reads from a deployment before the newest. */
export type PriorDeployment = Pick<DeploymentRow, "id" | "status" | "message">;

/**
 * How long a deployment may sit queued with no stage started before it needs
 * attention. Dispatch normally claims a queued deployment within a minute;
 * one still queued after this long is stuck behind something.
 */
export const QUEUED_ATTENTION_MINUTES = 15;
const MINUTE = 60_000;

/**
 * How many deployments in a row must have failed before a new one of the
 * same environment reads as failing repeatedly: one failure is a failure,
 * two and another attempt is a loop someone should break.
 */
export const FAILING_STREAK = 2;

/** The deployment states a new attempt is in before it has a result. */
const ATTEMPTING: ReadonlySet<string> = new Set(["queued", "running"]);

/** What an attention item reads from a deployment. */
export type AttentionDeployment = Pick<
  DeploymentRow,
  | "id"
  | "environmentId"
  | "serviceId"
  | "versionSetRevisionId"
  | "kind"
  | "requestedBy"
  | "message"
  | "status"
  | "recoveryRequired"
  | "createdAt"
  | "startedAt"
  | "finishedAt"
>;

/** A service whose newest build failed qualification. */
export type FailedBuild = {
  id: string;
  serviceId: string;
  serviceTitle: string;
  reason: string | null;
  at: string;
};

/** An environment whose accepted release a monitor alarm fired on. */
export type AlarmedRelease = {
  environmentId: string;
  serviceId: string;
  /** The accepted set revision the alarm fired on. */
  versionSetRevisionId: string;
  alarmedAt: Date;
};

/** The newest deployment of every environment, by environment id. */
export async function latestDeployments(database: Database) {
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

/**
 * The deployments just before each environment's newest, newest first: up to
 * `FAILING_STREAK` of them per environment, by environment id. One ranked
 * read for every environment, never one per environment.
 */
export async function priorDeployments(database: Database) {
  const rows = PriorRowsSchema.parse(
    await database.$queryRaw`
    SELECT "id", "environmentId", "status", "message" FROM (
      SELECT "id", "environmentId", "status", "message", ROW_NUMBER() OVER (
        PARTITION BY "environmentId" ORDER BY "createdAt" DESC, "id" DESC
      ) AS "rank" FROM "Deployment"
    ) AS "ranked"
    WHERE "rank" BETWEEN 2 AND ${FAILING_STREAK + 1}
    ORDER BY "environmentId", "rank"
  `,
  );
  const prior = new Map<string, PriorDeployment[]>();
  for (const { environmentId, ...row } of rows)
    prior.set(environmentId, [...(prior.get(environmentId) ?? []), row]);
  return prior;
}

/** A recorded message's first line, the cause before any detail under it. */
export function firstLine(message: string | null) {
  const line = message?.split("\n", 1)[0]?.trim() ?? "";
  return line === "" ? null : line;
}

/**
 * Deployments waiting for a person's decision, newest first: those awaiting
 * approval, and running ones whose saved plan waits for approval, as the
 * approvals page lists them.
 */
export function awaitingDecisions(database: Database) {
  return database.deployment.findMany({
    where: { OR: [{ status: "awaiting_approval" }, AWAITING_PLAN_DECISION] },
    orderBy: { createdAt: "desc" },
  });
}

/** Whether a deployment `awaitingDecisions` returned waits on a saved plan rather than an approval. */
function waitsOnPlan(deployment: { status: string }) {
  return deployment.status === "running";
}

/**
 * The status a page shows for a deployment: one waiting on a saved-plan
 * decision is awaiting approval, whatever its executor's status.
 */
export function decisionStatus(
  deployment: { id: string; status: string },
  awaiting: readonly { id: string; status: string }[],
) {
  return awaiting.some(
    (entry) => entry.id === deployment.id && waitsOnPlan(entry),
  )
    ? "awaiting_approval"
    : DeploymentStatusSchema.parse(deployment.status);
}

/** The newest build of every service, by service id. */
export async function latestBuilds(database: Database) {
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

/**
 * Names a deployment's subject as people say it, "Scout for LoL prod": the
 * service by its catalog title and the environment by its name. A service
 * this server's catalog does not declare is named by its id.
 */
export function deploymentSubjects(
  environments: readonly { id: string; name: string }[],
) {
  const names = new Map(environments.map((env) => [env.id, env.name]));
  return (deployment: { serviceId: string; environmentId: string }) => {
    const name = names.get(deployment.environmentId);
    if (name === undefined)
      throw new Error(
        `Deployment names unknown environment ${deployment.environmentId}`,
      );
    const service =
      servicePlacement(deployment.serviceId)?.title ?? deployment.serviceId;
    return `${service} ${name}`;
  };
}

/** A set revision's number as people say it, from the record's map; a missing one is a broken read. */
function revisionLabel(revisions: ReadonlyMap<string, number>, setId: string) {
  const revision = revisions.get(setId);
  if (revision === undefined)
    throw new Error(
      `Attention names set revision ${setId} the read did not hold`,
    );
  return `r${String(revision)}`;
}

/**
 * A new attempt after `FAILING_STREAK` failures in a row, as an item that
 * links the newest failure, which says why. Null when the deployments
 * before it did not all fail.
 */
function failingItem(
  deployment: AttentionDeployment,
  prior: readonly PriorDeployment[],
  subject: string,
  what: string,
): Attention | null {
  const streak = prior.slice(0, FAILING_STREAK);
  const [newest] = streak;
  if (
    newest === undefined ||
    streak.length < FAILING_STREAK ||
    !ATTEMPTING.has(deployment.status) ||
    streak.some((entry) => entry.status !== "failed")
  )
    return null;
  const reason = firstLine(newest.message);
  return {
    kind: "failed",
    title: `${subject} is failing repeatedly`,
    detail: `The last ${String(streak.length)} deployments failed${reason === null ? "" : `, the newest with: ${reason}`}. ${what} is ${deployment.status} again.`,
    at: deployment.createdAt.toISOString(),
    target: { kind: "deployment", id: newest.id },
    serviceId: deployment.serviceId,
  };
}

/** One environment's newest deployment as an item, when it needs someone. */
function deploymentItem(
  deployment: AttentionDeployment,
  subject: string,
  input: {
    revisions: ReadonlyMap<string, number>;
    now: Date;
    prior: readonly PriorDeployment[];
  },
): Attention | null {
  const target = { kind: "deployment", id: deployment.id } as const;
  const at = deployment.finishedAt?.toISOString() ?? null;
  // "The deploy of r274": what this item is about, so no two read alike.
  const what = `The ${deployment.kind} of ${revisionLabel(input.revisions, deployment.versionSetRevisionId)}`;
  const failing = failingItem(deployment, input.prior, subject, what);
  if (failing !== null) return failing;
  if (deployment.recoveryRequired)
    return {
      kind: "recovery",
      title: `${subject} requires recovery`,
      detail: `${what} failed and left the environment locked.`,
      at,
      target,
      serviceId: deployment.serviceId,
    };
  if (deployment.status === "failed")
    return {
      kind: "failed",
      title: `${subject} deployment failed`,
      detail:
        deployment.message === null
          ? `${what} failed.`
          : `${what} failed: ${deployment.message}`,
      at,
      target,
      serviceId: deployment.serviceId,
    };
  const waited = input.now.getTime() - deployment.createdAt.getTime();
  if (
    deployment.status === "queued" &&
    deployment.startedAt === null &&
    waited >= QUEUED_ATTENTION_MINUTES * MINUTE
  )
    return {
      kind: "queued",
      title: `${subject} deployment is still queued`,
      detail: `${what} has started no stage since it was requested, more than ${String(QUEUED_ATTENTION_MINUTES)} minutes ago.`,
      at: deployment.createdAt.toISOString(),
      target,
      serviceId: deployment.serviceId,
    };
  return null;
}

/**
 * What someone has to act on, newest first: deployments and saved plans
 * awaiting a decision; environments whose newest deployment failed, requires
 * recovery, retries after `FAILING_STREAK` failures in a row, or has sat
 * queued longer than `QUEUED_ATTENTION_MINUTES`;
 * environments whose accepted release a monitor alarm fired on; and services
 * whose newest build failed qualification. Each item says its reason once.
 */
export function attentionItems(input: {
  awaiting: readonly AttentionDeployment[];
  /** The newest deployment of each environment under watch. */
  latest: Iterable<AttentionDeployment>;
  /** The deployments before each environment's newest, newest first, by environment id. */
  prior: ReadonlyMap<string, readonly PriorDeployment[]>;
  alarms: readonly AlarmedRelease[];
  failedBuilds: readonly FailedBuild[];
  subject: (deployment: { serviceId: string; environmentId: string }) => string;
  /** Revision numbers of every set revision these deployments and alarms name, by id. */
  revisions: ReadonlyMap<string, number>;
  now: Date;
}): Attention[] {
  const { subject, revisions } = input;
  const items: Attention[] = input.awaiting.map((deployment) => {
    const what = `${deployment.kind} of ${revisionLabel(revisions, deployment.versionSetRevisionId)}`;
    return {
      kind: "approval",
      title: waitsOnPlan(deployment)
        ? `${subject(deployment)} awaits plan approval`
        : `${subject(deployment)} awaits approval`,
      detail: waitsOnPlan(deployment)
        ? `The saved plan for the ${what}, requested by ${deployment.requestedBy}.`
        : `The ${what}, requested by ${deployment.requestedBy}.`,
      at: deployment.createdAt.toISOString(),
      target: { kind: "deployment", id: deployment.id },
      serviceId: deployment.serviceId,
    };
  });
  for (const deployment of input.latest) {
    const item = deploymentItem(deployment, subject(deployment), {
      ...input,
      prior: input.prior.get(deployment.environmentId) ?? [],
    });
    if (item !== null) items.push(item);
  }
  for (const alarm of input.alarms)
    items.push({
      kind: "alarm",
      title: `${subject(alarm)} monitor alarm`,
      detail: `A monitor alarm fired on the accepted release ${revisionLabel(revisions, alarm.versionSetRevisionId)}. It stays live until a rollback or a new release replaces it.`,
      at: alarm.alarmedAt.toISOString(),
      target: { kind: "environment", id: alarm.environmentId },
      serviceId: alarm.serviceId,
    });
  for (const build of input.failedBuilds)
    items.push({
      kind: "build_failed",
      title: `${build.serviceTitle} build failed qualification`,
      detail: build.reason ?? "CI did not pass",
      at: build.at,
      target: { kind: "build", id: build.id },
      serviceId: build.serviceId,
    });
  return items.toSorted((left, right) =>
    (right.at ?? "").localeCompare(left.at ?? ""),
  );
}
