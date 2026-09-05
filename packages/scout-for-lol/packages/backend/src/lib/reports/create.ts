/**
 * The report create pipeline, extracted from `report.router.ts` so that every
 * surface that may create a report runs the same policy.
 *
 * This module deliberately knows nothing about tRPC: it returns a
 * discriminated result instead of throwing `TRPCError`, because the confirm
 * path for a prepared create intent is not a `guildMutationProcedure` and has
 * to map failures onto its own transport. The router maps the same results
 * back onto the errors it has always thrown.
 *
 * Everything here is transaction-scoped, and the caller owns the transaction:
 * the limit check has to see the same snapshot as the insert it guards, and
 * the schedule outbox row has to commit with the report. The two steps that
 * are *not* transaction work stay at the call site — `assertChannelInGuild`
 * (a Discord cache read) before, and `notifyReportScheduleReconciler()`
 * (a post-commit nudge) after.
 */

import type {
  DiscordAccountId,
  DiscordGuildId,
  ReportCreateInput,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { Report } from "#generated/prisma/client/index.js";
import type { Db } from "#src/database/index.ts";
import { canCreateAnotherUserReport } from "#src/lib/reports/authorization.ts";
import { enqueueReportScheduleUpsert } from "#src/reports/temporal-schedules.ts";

export type CreateReportResult =
  /** The report row and its schedule-outbox entry are staged in `tx`. */
  | { kind: "created"; report: Report }
  /** The server or owner is at its active-report limit. */
  | { kind: "limit_reached"; reason: string }
  /** `queryText` is not compilable ScoutQL. */
  | { kind: "invalid_query"; message: string };

export type CreateReportParams = {
  serverId: DiscordGuildId;
  ownerId: DiscordAccountId;
  input: ReportCreateInput;
  /** Creation timestamp; also the base for the first scheduled run. */
  now?: Date;
};

/**
 * Stage a new report inside `tx`. Returns a failure result without writing
 * anything when a policy check rejects the request, so the caller decides
 * whether to abort or simply commit an empty transaction.
 */
export async function createReportInTransaction(
  tx: Db,
  params: CreateReportParams,
): Promise<CreateReportResult> {
  const { serverId, ownerId, input } = params;

  const limitCheck = await canCreateAnotherUserReport({
    prisma: tx,
    serverId,
    ownerId,
  });
  if (!limitCheck.allowed) {
    return { kind: "limit_reached", reason: limitCheck.reason };
  }

  try {
    compileScoutQl(input.queryText);
  } catch (error) {
    return {
      kind: "invalid_query",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const now = params.now ?? new Date();
  const report = await tx.report.create({
    data: {
      serverId,
      ownerId,
      // Already validated by ReportCreateInputSchema's DiscordChannelIdSchema.
      channelId: input.channelId,
      title: input.title,
      description: input.description,
      queryText: input.queryText,
      isEnabled: input.isEnabled,
      isSystemManaged: false,
      cronExpression: input.cronExpression,
      scheduleTimezone: input.scheduleTimezone,
      nextScheduledRunAt: computeNextScheduledUpdateAt(
        input.cronExpression,
        now,
        input.scheduleTimezone,
      ),
      createdTime: now,
      updatedTime: now,
    },
  });
  await enqueueReportScheduleUpsert(tx, report.id, report.revision);
  return { kind: "created", report };
}
