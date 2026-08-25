import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  enqueueReportScheduleUpsert,
  notifyReportScheduleReconciler,
} from "#src/reports/temporal-schedules.ts";

export type SystemReportSyncResult = {
  created: number;
  updated: number;
  disabled: number;
};

/**
 * Retire competition-backed system reports from the generic report scheduler.
 * Competition delivery has one owner: the Temporal-triggered competition
 * dispatcher. Keeping this cleanup in the generic dispatch pass also disables
 * rows recreated by an older application version during a rollback window.
 */
export async function syncSystemReports(params: {
  prisma: ExtendedPrismaClient;
  now?: Date;
}): Promise<SystemReportSyncResult> {
  const now = params.now ?? new Date();
  const disabled = await params.prisma.$transaction(async (tx) => {
    const staleReports = await tx.report.findMany({
      where: {
        isSystemManaged: true,
        systemSource: "COMPETITION",
        isEnabled: true,
      },
      select: { id: true, revision: true },
    });
    for (const report of staleReports) {
      const revision = report.revision + 1;
      await tx.report.update({
        where: { id: report.id },
        data: { isEnabled: false, revision, updatedTime: now },
      });
      await enqueueReportScheduleUpsert(tx, report.id, revision);
    }
    return staleReports.length;
  });

  if (disabled > 0) await notifyReportScheduleReconciler();

  return { created: 0, updated: 0, disabled };
}
