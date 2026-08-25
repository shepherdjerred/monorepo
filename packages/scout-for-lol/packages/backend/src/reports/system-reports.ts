import type { ExtendedPrismaClient } from "#src/database/index.ts";

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
  const result = await params.prisma.report.updateMany({
    where: {
      isSystemManaged: true,
      systemSource: "COMPETITION",
      isEnabled: true,
    },
    data: {
      isEnabled: false,
      updatedTime: params.now ?? new Date(),
    },
  });

  return { created: 0, updated: 0, disabled: result.count };
}
