import type { Report } from "#generated/prisma/client/index.js";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutManualReport } from "#src/temporal/starts.ts";

export async function runManualReportWithTemporal(
  report: Report,
  post: boolean,
): Promise<{
  content: string;
  hasImage: boolean;
  rowsReturned: number;
  rowsScanned: number;
  posted: boolean;
}> {
  const run = await prisma.reportRun.create({
    data: {
      reportId: report.id,
      serverId: report.serverId,
      trigger: "MANUAL",
      status: "RUNNING",
      startedAt: new Date(),
      querySnapshot: report.queryText,
    },
  });
  try {
    const supervisor = currentScoutTemporalSupervisor();
    if (supervisor === undefined) throw new Error("Temporal is unavailable");
    const handle = await startScoutManualReport(supervisor.client(), {
      stage: configuration.environment,
      reportId: report.id.toString(),
      revision: report.revision,
      runId: run.id.toString(),
      source: "manual",
      post,
    });
    await handle.result();
  } catch (error) {
    await prisma.reportRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
  const completed = await prisma.reportRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  if (completed.status !== "SUCCESS") {
    throw new Error(completed.errorMessage ?? "Report execution failed");
  }
  if (post && completed.deliveryState !== "DELIVERED") {
    throw new Error(
      completed.deliveryError ?? "Report delivery did not complete",
    );
  }
  return {
    content: completed.renderedContent ?? "",
    hasImage: completed.imageS3Key !== null,
    rowsReturned: completed.rowsReturned,
    rowsScanned: completed.rowsScanned,
    posted: completed.deliveryState === "DELIVERED",
  };
}
