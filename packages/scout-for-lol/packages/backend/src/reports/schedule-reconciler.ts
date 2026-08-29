import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  type Client,
} from "@temporalio/client";
import {
  SCOUT_WORKFLOW_NAMES,
  ScoutScheduleOwnershipMemoSchema,
  scoutReportScheduleId,
  scoutTaskQueues,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  scoutTemporalReportScheduleDrift,
  scoutTemporalReportScheduleOrphans,
} from "#src/metrics/temporal.ts";
import { createLogger } from "#src/logger.ts";
import { scheduleMatchesReport } from "#src/reports/report-schedule-drift.ts";

const BATCH_SIZE = 100;
const OWNERSHIP_SCHEMA_VERSION = 1;
const logger = createLogger("report-schedule-reconciler");

type EnabledReportSchedule = {
  id: number;
  revision: number;
  cronExpression: string;
  scheduleTimezone: string;
};

function ownershipMemo(stage: ScoutStage, reportId: number) {
  return ScoutScheduleOwnershipMemoSchema.parse({
    owner: "scout-for-lol",
    stage,
    reportId: reportId.toString(),
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
  });
}

function scheduleConfiguration(input: {
  stage: ScoutStage;
  reportId: number;
  revision: number;
  cronExpression: string;
  timezone: string;
}) {
  return {
    spec: {
      cronExpressions: [input.cronExpression],
      timezone: input.timezone,
    },
    action: {
      type: "startWorkflow" as const,
      workflowType: SCOUT_WORKFLOW_NAMES.reportRun,
      args: [
        {
          stage: input.stage,
          reportId: input.reportId.toString(),
          revision: input.revision,
          source: "schedule" as const,
        },
      ],
      taskQueue: scoutTaskQueues(input.stage).workflow,
      workflowExecutionTimeout: 15 * 60 * 1000,
    },
    policies: {
      overlap: ScheduleOverlapPolicy.BUFFER_ONE,
      catchupWindow: 60 * 60 * 1000,
      pauseOnFailure: false,
    },
  };
}

async function assertOwned(
  client: Client,
  scheduleId: string,
  stage: ScoutStage,
  reportId: number,
): Promise<void> {
  const description = await client.schedule.getHandle(scheduleId).describe();
  const memo = ScoutScheduleOwnershipMemoSchema.safeParse(description.memo);
  if (
    !memo.success ||
    memo.data.stage !== stage ||
    memo.data.reportId !== reportId.toString()
  ) {
    throw new Error(
      `Refusing to modify unowned or mismatched Temporal Schedule ${scheduleId}`,
    );
  }
}

async function deleteOwnedSchedule(
  client: Client,
  stage: ScoutStage,
  reportId: number,
): Promise<void> {
  const scheduleId = scoutReportScheduleId(stage, reportId.toString());
  try {
    await assertOwned(client, scheduleId, stage, reportId);
    await client.schedule.getHandle(scheduleId).delete();
  } catch (error) {
    if (!(error instanceof ScheduleNotFoundError)) throw error;
  }
}

async function saveReportSchedule(input: {
  client: Client;
  stage: ScoutStage;
  reportId: number;
  scheduleId: string;
  configuration: ReturnType<typeof scheduleConfiguration>;
}): Promise<void> {
  const handle = input.client.schedule.getHandle(input.scheduleId);
  try {
    await assertOwned(
      input.client,
      input.scheduleId,
      input.stage,
      input.reportId,
    );
    await handle.update((previous) => ({
      ...input.configuration,
      state: previous.state,
    }));
  } catch (error) {
    if (!(error instanceof ScheduleNotFoundError)) throw error;
    await input.client.schedule.create({
      scheduleId: input.scheduleId,
      ...input.configuration,
      memo: ownershipMemo(input.stage, input.reportId),
    });
  }
}

async function upsertReportSchedule(input: {
  client: Client;
  stage: ScoutStage;
  reportId: number;
  revision: number;
  database: ExtendedPrismaClient;
}): Promise<void> {
  const report = await input.database.report.findUnique({
    where: { id: input.reportId },
  });
  if (report?.isEnabled !== true) {
    await deleteOwnedSchedule(input.client, input.stage, input.reportId);
    return;
  }
  if (report.revision !== input.revision) return;

  const scheduleId = scoutReportScheduleId(
    input.stage,
    input.reportId.toString(),
  );
  const configuration = scheduleConfiguration({
    stage: input.stage,
    reportId: input.reportId,
    revision: input.revision,
    cronExpression: report.cronExpression,
    timezone: report.scheduleTimezone,
  });
  await saveReportSchedule({
    client: input.client,
    stage: input.stage,
    reportId: input.reportId,
    scheduleId,
    configuration,
  });

  if (
    report.nextScheduledRunAt !== null &&
    report.nextScheduledRunAt.getTime() <= Date.now()
  ) {
    await input.client.schedule
      .getHandle(scheduleId)
      .trigger(ScheduleOverlapPolicy.BUFFER_ONE);
  }
}

async function auditReportSchedules(
  client: Client,
  stage: ScoutStage,
  database: ExtendedPrismaClient,
): Promise<void> {
  const reports = await database.report.findMany({
    where: { isEnabled: true },
    select: {
      id: true,
      revision: true,
      cronExpression: true,
      scheduleTimezone: true,
    },
  });
  const desiredIds = new Set(
    reports.map((report) => scoutReportScheduleId(stage, report.id.toString())),
  );
  const ownedIds = new Set<string>();
  const unknownIds = new Set<string>();
  const prefix = `scout-${stage}-report-`;
  for await (const summary of client.schedule.list()) {
    if (!summary.scheduleId.startsWith(prefix)) continue;
    // Fixed Scout schedules share the report prefix only when their names are
    // introduced by a future operator convention. Report schedules always end
    // in the numeric database ID; leave every other owned fixed schedule to its
    // own reconciler and orphan audit.
    const reportSuffix = summary.scheduleId.slice(prefix.length);
    if (!/^\d+$/.test(reportSuffix)) continue;
    const memo = ScoutScheduleOwnershipMemoSchema.safeParse(summary.memo);
    if (
      memo.success &&
      summary.scheduleId === scoutReportScheduleId(stage, memo.data.reportId) &&
      memo.data.stage === stage
    ) {
      ownedIds.add(summary.scheduleId);
    } else {
      unknownIds.add(summary.scheduleId);
    }
  }

  const drift = await reconcileDesiredReportSchedules({
    client,
    stage,
    database,
    reports,
    ownedIds,
    unknownIds,
  });
  const orphans = await deleteOrphanedReportSchedules(
    client,
    stage,
    ownedIds,
    desiredIds,
  );

  scoutTemporalReportScheduleDrift.set({ temporal_namespace: stage }, drift);
  scoutTemporalReportScheduleOrphans.set(
    { temporal_namespace: stage },
    orphans,
  );
  if (unknownIds.size > 0) {
    logger.error(
      "Unknown Scout report Schedule ownership mismatches detected",
      {
        stage,
        scheduleIds: [...unknownIds].sort(),
      },
    );
  }
}

async function reconcileDesiredReportSchedules(input: {
  client: Client;
  stage: ScoutStage;
  database: ExtendedPrismaClient;
  reports: EnabledReportSchedule[];
  ownedIds: Set<string>;
  unknownIds: Set<string>;
}): Promise<number> {
  let drift = input.unknownIds.size;
  for (const report of input.reports) {
    const scheduleId = scoutReportScheduleId(input.stage, report.id.toString());
    if (!input.ownedIds.has(scheduleId)) {
      drift += 1;
      if (!input.unknownIds.has(scheduleId)) {
        await upsertReportSchedule({
          client: input.client,
          stage: input.stage,
          reportId: report.id,
          revision: report.revision,
          database: input.database,
        });
      }
      continue;
    }
    const description = await input.client.schedule
      .getHandle(scheduleId)
      .describe();
    if (
      !scheduleMatchesReport(description, {
        stage: input.stage,
        reportId: report.id,
        revision: report.revision,
        cronExpression: report.cronExpression,
        timezone: report.scheduleTimezone,
      })
    ) {
      drift += 1;
      await upsertReportSchedule({
        client: input.client,
        stage: input.stage,
        reportId: report.id,
        revision: report.revision,
        database: input.database,
      });
    }
  }
  return drift;
}

async function deleteOrphanedReportSchedules(
  client: Client,
  stage: ScoutStage,
  ownedIds: Set<string>,
  desiredIds: Set<string>,
): Promise<number> {
  let orphans = 0;
  for (const scheduleId of ownedIds) {
    if (desiredIds.has(scheduleId)) continue;
    orphans += 1;
    const description = await client.schedule.getHandle(scheduleId).describe();
    const memo = ScoutScheduleOwnershipMemoSchema.parse(description.memo);
    const reportId = Number(memo.reportId);
    if (!Number.isSafeInteger(reportId) || reportId <= 0) {
      throw new Error(
        `Owned report Schedule has invalid report ID ${memo.reportId}`,
      );
    }
    await deleteOwnedSchedule(client, stage, reportId);
  }
  return orphans;
}

export async function drainReportScheduleOutbox(
  client: Client,
  stage: ScoutStage,
  database: ExtendedPrismaClient = prisma,
): Promise<{ processed: number; remaining: number }> {
  const rows = await database.reportScheduleOutbox.findMany({
    where: { processedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
  });
  for (const row of rows) {
    if (row.operation === "UPSERT") {
      await upsertReportSchedule({
        client,
        stage,
        reportId: row.reportId,
        revision: row.revision,
        database,
      });
    } else if (row.operation === "DELETE") {
      await deleteOwnedSchedule(client, stage, row.reportId);
    } else {
      throw new Error(
        `Unknown ReportScheduleOutbox operation ${row.operation}`,
      );
    }
    await database.reportScheduleOutbox.update({
      where: { id: row.id },
      data: { processedAt: new Date() },
    });
  }
  const remaining = await database.reportScheduleOutbox.count({
    where: { processedAt: null },
  });
  if (remaining === 0) await auditReportSchedules(client, stage, database);
  return { processed: rows.length, remaining };
}
