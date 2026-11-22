import {
  PROBLEM_ACTION_SUFFIXES,
  type ActivityEntry,
  type ActivityQuery,
  type ActivitySubject,
} from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { firstLine } from "./attention.ts";
import { decodeCursor, olderThan, page, PAGE_SIZE } from "./cursor.ts";
import { causeStagesOf, recoveryIntentsOf, stated } from "./recovery.ts";
import { activityEntry, entityDomain } from "./views.ts";

type AuditRow = Prisma.AuditGetPayload<object>;

const WINDOW_MS = { hour: 3_600_000, day: 86_400_000 } as const;

/** The audit rows an activity query selects, before its cursor. */
export function activityWhere(
  query: ActivityQuery,
  now: Date,
): Prisma.AuditWhereInput {
  return {
    ...(query.actor === undefined ? {} : { actor: query.actor }),
    ...(query.action === undefined
      ? {}
      : { action: { startsWith: query.action } }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
    ...(query.within === undefined
      ? {}
      : {
          occurredAt: {
            gte: new Date(now.getTime() - WINDOW_MS[query.within]),
          },
        }),
    AND: [
      query.problems === undefined
        ? {}
        : {
            OR: PROBLEM_ACTION_SUFFIXES.map((suffix) => ({
              action: { endsWith: suffix },
            })),
          },
      olderThan(decodeCursor(query.cursor), "occurredAt"),
    ],
  };
}

function ids(rows: readonly AuditRow[], domain: string) {
  return [
    ...new Set(
      rows
        .filter((row) => entityDomain(row.action) === domain)
        .map((row) => row.entityId),
    ),
  ];
}

/**
 * The results whose entry says why: a deployment's failure, with or without
 * a lock, and a build CI failed or found incompatible.
 */
const FAILURE_ACTIONS: ReadonlySet<string> = new Set([
  "deployment.failed",
  "deployment.recovery_required",
  "build.failed",
  "build.incompatible",
]);

/**
 * The service, environment and set revision number of every deployment,
 * build and version set a page of audit rows is about, and why each
 * deployment or build failed: one read per kind for the whole page, never one
 * per row.
 */
async function activitySubjects(
  database: Database,
  rows: readonly AuditRow[],
): Promise<{
  subjects: Map<string, ActivitySubject>;
  messages: Map<string, string | null>;
}> {
  const [deployments, builds, versions] = await Promise.all([
    database.deployment.findMany({
      where: { id: { in: ids(rows, "deployment") } },
      select: {
        id: true,
        serviceId: true,
        environmentId: true,
        versionSetRevisionId: true,
        message: true,
        recoveryRequired: true,
      },
    }),
    database.build.findMany({
      where: { id: { in: ids(rows, "build") } },
      select: { id: true, serviceId: true, qualificationReason: true },
    }),
    database.versionSet.findMany({
      where: { id: { in: ids(rows, "versionSet") } },
      select: { id: true, serviceId: true, revision: true },
    }),
  ]);
  const [deployed, intents] = await Promise.all([
    database.versionSet.findMany({
      where: {
        id: { in: deployments.map((row) => row.versionSetRevisionId) },
      },
      select: { id: true, revision: true },
    }),
    recoveryIntentsOf(
      database,
      deployments.map((row) => row.id),
    ),
  ]);
  const stages = await causeStagesOf(database, intents);
  const revisionOf = new Map(deployed.map((row) => [row.id, row.revision]));
  const subjects = new Map<string, ActivitySubject>([
    ...deployments.map((row): [string, ActivitySubject] => [
      row.id,
      {
        serviceId: row.serviceId,
        environmentId: row.environmentId,
        revision: revisionOf.get(row.versionSetRevisionId) ?? null,
      },
    ]),
    ...builds.map((row): [string, ActivitySubject] => [
      row.id,
      { serviceId: row.serviceId, environmentId: null, revision: null },
    ]),
    ...versions.map((row): [string, ActivitySubject] => [
      row.id,
      { serviceId: row.serviceId, environmentId: null, revision: row.revision },
    ]),
  ]);
  return {
    subjects,
    messages: new Map([
      // A failure whose recovery settled says what recovery read back.
      ...deployments.map((row): [string, string | null] => [
        row.id,
        stated(row, intents, stages).message,
      ]),
      ...builds.map((row): [string, string | null] => [
        row.id,
        row.qualificationReason,
      ]),
    ]),
  };
}

/**
 * One page of the audit trail, newest first, each entry with what it is
 * about, and a deployment failure with the first line of why it failed.
 */
export async function activityPage(
  database: Database,
  query: ActivityQuery,
  now = new Date(),
): Promise<{ items: ActivityEntry[]; nextCursor: string | null }> {
  const rows = await database.audit.findMany({
    where: activityWhere(query, now),
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });
  const selected = page(rows, PAGE_SIZE, (row) => row.occurredAt);
  const { subjects, messages } = await activitySubjects(
    database,
    selected.items,
  );
  return {
    items: selected.items.map((row) => ({
      ...activityEntry(row),
      subject: subjects.get(row.entityId) ?? null,
      ...(FAILURE_ACTIONS.has(row.action)
        ? { reason: firstLine(messages.get(row.entityId) ?? null) }
        : {}),
    })),
    nextCursor: selected.nextCursor,
  };
}
