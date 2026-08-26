import type { ExtendedPrismaClient } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { signalScoutReportReconciliation } from "#src/temporal/starts.ts";

const logger = createLogger("report-temporal-schedules");

type ReportScheduleOutboxClient = Pick<
  ExtendedPrismaClient,
  "reportScheduleOutbox"
>;

export async function enqueueReportScheduleUpsert(
  database: ReportScheduleOutboxClient,
  reportId: number,
  revision: number,
): Promise<void> {
  await database.reportScheduleOutbox.create({
    data: { reportId, revision, operation: "UPSERT" },
  });
}

export async function enqueueReportScheduleDeletion(
  database: ReportScheduleOutboxClient,
  reportId: number,
  revision: number,
): Promise<void> {
  await database.reportScheduleOutbox.create({
    data: { reportId, revision, operation: "DELETE" },
  });
}

export async function notifyReportScheduleReconciler(): Promise<void> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    logger.warn(
      "Report schedule outbox committed while Temporal is unavailable; the reconciliation Schedule will recover it",
    );
    return;
  }
  try {
    await signalScoutReportReconciliation(
      supervisor.client(),
      configuration.environment,
    );
  } catch (error) {
    logger.warn(
      "Report schedule outbox committed but the reconciler Signal was not accepted",
      { error },
    );
  }
}
