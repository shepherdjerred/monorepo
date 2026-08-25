import {
  REPORT_AI_TIMEOUT_MS,
  ReportAiStreamEventSchema,
  type ReportAiEditRequest,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import type { InteractiveOutcome } from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutInteractiveRun } from "#src/temporal/starts.ts";
import { streamReportQueryAgent } from "#src/reports/ai/report-query-agent.ts";
import {
  getReportAiQuotaStatus,
  type ReportAiRateLimitIdentity,
  type ReportAiRateLimitTicket,
} from "#src/reports/ai/rate-limit.ts";
import { requestStopSignal } from "@scout-for-lol/temporal/signals";
import { scoutInteractiveWorkflowId } from "@scout-for-lol/temporal";
import {
  scoutReportAiActiveRuns,
  scoutReportAiRunDurationSeconds,
  scoutReportAiRunsTotal,
} from "#src/metrics/report-ai.ts";
import { createLogger } from "#src/logger.ts";

const encoder = new TextEncoder();
const logger = createLogger("report-ai-temporal-runtime");

type ActiveReportAiRuntime = {
  abortController: AbortController;
  execute: () => Promise<InteractiveOutcome>;
  finish: (outcome: InteractiveOutcome) => void;
};

const activeRuns = new Map<string, ActiveReportAiRuntime>();

export function reportAiRuntime(
  runId: string,
): ActiveReportAiRuntime | undefined {
  return activeRuns.get(runId);
}

export function createTemporalReportAiResponse(input: {
  request: Request;
  edit: ReportAiEditRequest;
  identity: ReportAiRateLimitIdentity;
  ticket: ReportAiRateLimitTicket & { allowed: true };
  exempt: boolean;
  corsHeaders: Record<string, string>;
}): Response {
  let controllerReference:
    ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerReference = controller;
    },
    cancel() {
      void requestTemporalReportAiStop(input.ticket.runId);
    },
  });
  const controller = controllerReference;
  if (controller === undefined) {
    throw new Error("Report AI stream did not initialize");
  }

  let closed = false;
  let finished = false;
  let partial = "";
  const startedAt = Date.now();
  scoutReportAiActiveRuns.inc();
  const events: ReportAiStreamEvent[] = [];
  const emit = async (event: ReportAiStreamEvent): Promise<void> => {
    const parsed = ReportAiStreamEventSchema.parse(event);
    events.push(parsed);
    if (parsed.type === "draft_delta") partial += parsed.text;
    await prisma.scoutInteractiveRun.update({
      where: { id: input.ticket.runId },
      data: {
        partialOutput: partial.length === 0 ? null : partial,
        trace: JSON.stringify(events),
      },
    });
    if (closed) return;
    try {
      controller.enqueue(
        encoder.encode(
          `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
        ),
      );
    } catch {
      closed = true;
    }
  };

  const abortController = new AbortController();
  const close = (): void => {
    if (closed) return;
    try {
      controller.enqueue(
        encoder.encode('event: done\ndata: {"type":"done"}\n\n'),
      );
      controller.close();
    } catch {
      // A disconnected browser is only an observer; durable execution and
      // cleanup continue through Temporal and Postgres.
    }
    closed = true;
  };
  const abortFromRequest = (): void => {
    void requestTemporalReportAiStop(input.ticket.runId);
  };
  input.request.signal.addEventListener("abort", abortFromRequest, {
    once: true,
  });
  if (input.request.signal.aborted) abortFromRequest();
  const timeout = setTimeout(() => {
    void requestTemporalReportAiStop(input.ticket.runId);
  }, REPORT_AI_TIMEOUT_MS);

  const runtime: ActiveReportAiRuntime = {
    abortController,
    execute: async () => {
      const draft = await streamReportQueryAgent({
        runId: input.ticket.runId,
        input: input.edit,
        abortSignal: abortController.signal,
        emit,
      });
      input.ticket.finish();
      await emit({
        type: "final",
        draft,
        formattedQueryText: draft.queryText,
        quota: getReportAiQuotaStatus(input.identity, Date.now(), {
          exempt: input.exempt,
        }).quota,
      });
      return {
        status: "completed",
        partialOutputAvailable: partial.length > 0,
      };
    },
    finish: (outcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      input.request.signal.removeEventListener("abort", abortFromRequest);
      input.ticket.finish();
      scoutReportAiActiveRuns.dec();
      const metricStatus =
        outcome.status === "completed"
          ? "success"
          : outcome.status === "cancelled"
            ? "cancelled"
            : "error";
      scoutReportAiRunsTotal.inc({ status: metricStatus });
      scoutReportAiRunDurationSeconds
        .labels(metricStatus)
        .observe((Date.now() - startedAt) / 1000);
      if (!closed && outcome.status !== "completed") {
        void (async () => {
          try {
            await emit({
              type: "error",
              message:
                outcome.status === "cancelled"
                  ? "Report AI generation was cancelled."
                  : outcome.status === "interrupted"
                    ? "Report AI generation was interrupted; Scout did not risk a duplicate provider request."
                    : "Report AI generation failed.",
              retryAfterSeconds: null,
              quota: getReportAiQuotaStatus(input.identity, Date.now(), {
                exempt: input.exempt,
              }).quota,
            });
          } finally {
            close();
          }
        })();
      } else {
        close();
      }
      activeRuns.delete(input.ticket.runId);
    },
  };
  activeRuns.set(input.ticket.runId, runtime);

  void (async () => {
    try {
      await emit({ type: "started", runId: input.ticket.runId });
      const supervisor = currentScoutTemporalSupervisor();
      if (supervisor === undefined) throw new Error("Temporal is unavailable");
      await startScoutInteractiveRun(supervisor.client(), {
        stage: configuration.environment,
        kind: "report-ai",
        databaseRunId: input.ticket.runId,
      });
    } catch (error) {
      const terminalized = await prisma.scoutInteractiveRun.updateMany({
        where: { id: input.ticket.runId, state: "PENDING" },
        data: {
          state: "FAILED",
          outcome: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
      // Temporal may have accepted the workflow even when this HTTP request
      // lost its response. If the activity already claimed the row, leave the
      // live runtime and SSE stream alone; the workflow owns finalization.
      if (terminalized.count === 1) {
        runtime.finish({ status: "failed", partialOutputAvailable: false });
      }
    }
  })();

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...input.corsHeaders,
    },
  });
}

async function requestTemporalReportAiStop(runId: string): Promise<void> {
  await prisma.scoutInteractiveRun.updateMany({
    where: {
      id: runId,
      state: { in: ["PENDING", "RUNNING"] },
      stopRequestedAt: null,
    },
    data: { stopRequestedAt: new Date() },
  });
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) return;
  try {
    await supervisor
      .client()
      .workflow.getHandle(
        scoutInteractiveWorkflowId(
          configuration.environment,
          "report-ai",
          runId,
        ),
      )
      .signal(requestStopSignal);
  } catch (error) {
    logger.warn(
      `Persisted stop for report-AI run ${runId} before its Workflow could be signalled`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
