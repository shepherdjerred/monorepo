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
  const staleReports = await params.prisma.report.findMany({
    where: {
      isSystemManaged: true,
      systemSource: "COMPETITION",
      isEnabled: true,
    },
    select: { id: true },
  });
  const now = params.now ?? new Date();
  for (const stale of staleReports) {
    await params.prisma.$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id: stale.id },
        data: {
          isEnabled: false,
          nextScheduledRunAt: null,
          revision: { increment: 1 },
          updatedTime: now,
        },
      });
      await enqueueReportScheduleUpsert(tx, report.id, report.revision);
    });
  }
  if (staleReports.length > 0) {
    await notifyReportScheduleReconciler();
  }

  return { created: 0, updated: 0, disabled: staleReports.length };
}
