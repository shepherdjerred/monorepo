import {
  PlaytestListResponseSchema,
  PlaytestReportSchema,
  PlaytestRunRequestSchema,
  PlaytestRunResponseSchema,
  RunIdSchema,
} from "#protocol/playtest.ts";
import {
  listRuns,
  readRun,
  runPlaytests,
  type RunnerContext,
} from "#daemon/playtests.ts";
import { body, DaemonError, reply } from "./http.ts";

export async function dispatchPlaytests(
  ctx: RunnerContext,
  request: Request,
  runId: string | undefined,
): Promise<Response> {
  if (runId === undefined && request.method === "POST") {
    const run = await body(request, PlaytestRunRequestSchema);
    ctx.log("playtest run", { files: run.files, target: run.target });
    return reply(PlaytestRunResponseSchema, await runPlaytests(ctx, run));
  }
  if (runId === undefined && request.method === "GET") {
    const reports = await listRuns();
    return reply(PlaytestListResponseSchema, {
      runs: reports.map((report) => ({
        runId: report.runId,
        scenario: report.scenario.name,
        status: report.status,
        startedAt: report.startedAt,
        durationMs: report.durationMs,
      })),
    });
  }
  if (runId !== undefined && request.method === "GET") {
    const parsed = RunIdSchema.safeParse(runId);
    if (!parsed.success) {
      throw new DaemonError(`Invalid run id ${runId}`);
    }
    return reply(PlaytestReportSchema, await readRun(parsed.data));
  }
  throw new DaemonError(`Unknown route ${request.method} /playtests`, 404);
}
