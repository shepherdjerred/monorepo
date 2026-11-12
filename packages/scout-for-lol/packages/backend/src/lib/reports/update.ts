/**
 * The report update pipeline, extracted from `report.router.ts` so that every
 * surface that may edit a report runs the same policy — the web form and the
 * Explore `report_update` confirmation path alike.
 *
 * Mirrors `create.ts`: this module knows nothing about tRPC, returns a
 * discriminated result instead of throwing `TRPCError`, and everything is
 * transaction-scoped with the caller owning the transaction. The schedule
 * outbox row commits with the report edit it describes. Steps that are not
 * transaction work stay at the call site — `assertChannelInGuild` (a Discord
 * cache read) before, and `notifyReportScheduleReconciler()` after.
 */

import type {
  DiscordGuildId,
  ReportId,
  ReportUpdateInput,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/parse/compile.ts";
import type { Report } from "#generated/prisma/client/index.js";
import type { Db } from "#src/database/index.ts";
import {
  enqueueReportScheduleDeletion,
  enqueueReportScheduleUpsert,
} from "#src/reports/schedule/temporal-schedules.ts";

export type UpdateReportResult =
  /** The report row and its schedule-outbox entry are staged in `tx`. */
  | { kind: "updated"; report: Report }
  /** No report with that id exists in the guild. */
  | { kind: "not_found" }
  /** System-managed reports are read-only. */
  | { kind: "system_managed" }
  /** `queryText` is not compilable ScoutQL. */
  | { kind: "invalid_query"; message: string };

/**
 * The next scheduled run after an edit, or `undefined` to leave it alone:
 * disabling clears it, enabling or moving the schedule recomputes it, and a
 * plain rename touches neither.
 */
function nextRunForUpdate(input: {
  isEnabled: boolean | undefined;
  scheduleChanged: boolean;
  cron: string;
  timezone: string;
  now: Date;
}): Date | null | undefined {
  if (input.isEnabled === false) return null;
  return input.scheduleChanged || input.isEnabled === true
    ? computeNextScheduledUpdateAt(input.cron, input.now, input.timezone)
    : undefined;
}

export type UpdateReportParams = {
  reportId: ReportId;
  serverId: DiscordGuildId;
  input: ReportUpdateInput;
  /** Edit timestamp; also the base for a recomputed scheduled run. */
  now?: Date;
};

/**
 * Stage an edit to an existing report inside `tx`.
 *
 * Reloads the report inside the transaction, so a report deleted or made
 * system-managed between prepare and confirm is refused against live state
 * rather than the caller's stale read. `nextScheduledRunAt` is recomputed
 * only when the schedule or the enabled flag actually moves, matching the
 * behaviour the web router had inline.
 */
export async function updateReportInTransaction(
  tx: Db,
  params: UpdateReportParams,
): Promise<UpdateReportResult> {
  const { reportId, serverId, input } = params;
  const existing = await tx.report.findFirst({
    where: { id: reportId, serverId },
  });
  if (existing === null) return { kind: "not_found" };
  if (existing.isSystemManaged) return { kind: "system_managed" };

  if (input.queryText !== undefined) {
    try {
      compileScoutQl(input.queryText);
    } catch (error) {
      return {
        kind: "invalid_query",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const now = params.now ?? new Date();
  const scheduleChanged =
    input.cronExpression !== undefined || input.scheduleTimezone !== undefined;
  const effectiveCron = input.cronExpression ?? existing.cronExpression;
  const effectiveTimezone = input.scheduleTimezone ?? existing.scheduleTimezone;
  const nextScheduledRunAt = nextRunForUpdate({
    isEnabled: input.isEnabled,
    scheduleChanged,
    cron: effectiveCron,
    timezone: effectiveTimezone,
    now,
  });

  const updated = await tx.report.update({
    where: { id: existing.id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
      ...(input.queryText === undefined ? {} : { queryText: input.queryText }),
      ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
      ...(scheduleChanged
        ? {
            cronExpression: effectiveCron,
            scheduleTimezone: effectiveTimezone,
          }
        : {}),
      ...(nextScheduledRunAt === undefined ? {} : { nextScheduledRunAt }),
      revision: { increment: 1 },
      updatedTime: now,
    },
  });
  await enqueueReportScheduleUpsert(tx, updated.id, updated.revision);
  return { kind: "updated", report: updated };
}

export type SetReportEnabledResult =
  | { kind: "updated"; report: Report }
  | { kind: "not_found" }
  | { kind: "system_managed" };

/** Stage enabling or disabling a report inside `tx`. */
export async function setReportEnabledInTransaction(
  tx: Db,
  params: {
    reportId: ReportId;
    serverId: DiscordGuildId;
    isEnabled: boolean;
    now?: Date;
  },
): Promise<SetReportEnabledResult> {
  const existing = await tx.report.findFirst({
    where: { id: params.reportId, serverId: params.serverId },
  });
  if (existing === null) return { kind: "not_found" };
  if (existing.isSystemManaged) return { kind: "system_managed" };
  const now = params.now ?? new Date();
  const updated = await tx.report.update({
    where: { id: existing.id },
    data: params.isEnabled
      ? {
          isEnabled: true,
          nextScheduledRunAt: computeNextScheduledUpdateAt(
            existing.cronExpression,
            now,
            existing.scheduleTimezone,
          ),
          revision: { increment: 1 },
          updatedTime: now,
        }
      : {
          isEnabled: false,
          nextScheduledRunAt: null,
          revision: { increment: 1 },
          updatedTime: now,
        },
  });
  await enqueueReportScheduleUpsert(tx, updated.id, updated.revision);
  return { kind: "updated", report: updated };
}

export type DeleteReportResult =
  { kind: "deleted" } | { kind: "not_found" } | { kind: "system_managed" };

/** Stage deleting a report and its schedule inside `tx`. */
export async function deleteReportInTransaction(
  tx: Db,
  params: { reportId: ReportId; serverId: DiscordGuildId },
): Promise<DeleteReportResult> {
  const existing = await tx.report.findFirst({
    where: { id: params.reportId, serverId: params.serverId },
  });
  if (existing === null) return { kind: "not_found" };
  if (existing.isSystemManaged) return { kind: "system_managed" };
  const deleting = await tx.report.update({
    where: { id: existing.id },
    data: { revision: { increment: 1 } },
    select: { id: true, revision: true },
  });
  await enqueueReportScheduleDeletion(tx, deleting.id, deleting.revision);
  await tx.report.delete({
    where: { id: deleting.id, revision: deleting.revision },
  });
  return { kind: "deleted" };
}
