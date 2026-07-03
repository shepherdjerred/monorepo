import { TRPCError } from "@trpc/server";
import {
  DiscordAccountIdSchema,
  ReportAiEditRequestSchema,
  ReportAiHttpErrorSchema,
  REPORT_AI_REQUEST_MAX_BYTES,
  REPORT_AI_TIMEOUT_MS,
  ReportAiStreamEventSchema,
  type ReportAiEditRequest,
  type ReportAiQuotaSnapshot,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { createContext, type Context } from "#src/trpc/context.ts";
import { assertGuildAdmin } from "#src/trpc/guild-guard.ts";
import { streamReportQueryAgent } from "#src/reports/ai/report-query-agent.ts";
import {
  getReportAiQuotaStatus,
  tryStartReportAiRun,
  type ReportAiRateLimitIdentity,
} from "#src/reports/ai/rate-limit.ts";
import { getReportAiEditStatus } from "#src/reports/ai/status.ts";
import {
  scoutReportAiActiveRuns,
  scoutReportAiRunDurationSeconds,
  scoutReportAiRunsTotal,
} from "#src/metrics/report-ai.ts";

const STREAM_PATH = "/api/reports/query-agent/stream";
const encoder = new TextEncoder();

export async function handleReportAiRoute(
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== STREAM_PATH) {
    return null;
  }

  if (request.method !== "POST") {
    return jsonError("Method not allowed.", 405, corsHeaders);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > REPORT_AI_REQUEST_MAX_BYTES) {
    return jsonError("Request body is too large.", 413, corsHeaders);
  }

  const bodyText = await request.text();
  if (encoder.encode(bodyText).byteLength > REPORT_AI_REQUEST_MAX_BYTES) {
    return jsonError("Request body is too large.", 413, corsHeaders);
  }

  const parsedBody = parseRequestBody(bodyText);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.message, 400, corsHeaders);
  }

  const authResult = await authenticateReportAiRequest(
    request,
    parsedBody.input,
  );
  if (!authResult.ok) {
    return jsonError(authResult.message, authResult.status, corsHeaders);
  }

  const status = getReportAiEditStatus(authResult.identity);
  if (!status.enabled) {
    scoutReportAiRunsTotal.inc({ status: "disabled" });
    return jsonError(
      status.disabledReason ?? "AI report editing is disabled.",
      403,
      corsHeaders,
      { quota: status.quota },
    );
  }

  const ticket = tryStartReportAiRun(authResult.identity);
  if (!ticket.allowed) {
    scoutReportAiRunsTotal.inc({ status: "rate_limited" });
    return jsonError(ticket.reason, 429, corsHeaders, {
      quota: ticket.quota,
      retryAfterSeconds: ticket.retryAfterSeconds,
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort("Report AI stream timed out.");
      }, REPORT_AI_TIMEOUT_MS);
      const abortFromRequest = () => {
        abortController.abort("Client disconnected.");
      };
      request.signal.addEventListener("abort", abortFromRequest);
      let closed = false;
      let runStatus = "error";
      const startedAt = Date.now();
      scoutReportAiActiveRuns.inc();

      const emit = (event: ReportAiStreamEvent): void => {
        if (closed) {
          return;
        }
        const parsed = ReportAiStreamEventSchema.parse(event);
        controller.enqueue(
          encoder.encode(
            `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
          ),
        );
      };

      emit({
        type: "started",
        runId: ticket.runId,
      });

      void (async () => {
        try {
          const draft = await streamReportQueryAgent({
            runId: ticket.runId,
            input: parsedBody.input,
            abortSignal: abortController.signal,
            emit,
          });
          ticket.finish();
          runStatus = "success";
          emit({
            type: "final",
            draft,
            formattedQueryText: draft.queryText,
            quota: getReportAiQuotaStatus(authResult.identity).quota,
          });
        } catch (error) {
          runStatus = abortController.signal.aborted ? "cancelled" : "error";
          emit({
            type: "error",
            message: errorMessage(error),
            retryAfterSeconds: null,
            quota: getReportAiQuotaStatus(authResult.identity).quota,
          });
        } finally {
          clearTimeout(timeout);
          request.signal.removeEventListener("abort", abortFromRequest);
          ticket.finish();
          scoutReportAiActiveRuns.dec();
          scoutReportAiRunsTotal.inc({ status: runStatus });
          scoutReportAiRunDurationSeconds
            .labels(runStatus)
            .observe((Date.now() - startedAt) / 1000);
          emit({ type: "done" });
          closed = true;
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders,
    },
  });
}

type ParsedRequestBody =
  | { ok: true; input: ReportAiEditRequest }
  | { ok: false; message: string };

function parseRequestBody(bodyText: string): ParsedRequestBody {
  try {
    const raw: unknown = JSON.parse(bodyText);
    const parsed = ReportAiEditRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message };
    }
    return { ok: true, input: parsed.data };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

type AuthResult =
  | {
      ok: true;
      identity: ReportAiRateLimitIdentity;
    }
  | { ok: false; status: number; message: string };

async function authenticateReportAiRequest(
  request: Request,
  input: ReportAiEditRequest,
): Promise<AuthResult> {
  try {
    const ctx = await createContext(request);
    const web = readWebCsrfContext(ctx);
    assertWebCsrf(web.webSession);
    await assertGuildAdmin({ user: web.user, guildId: input.guildId });
    return {
      ok: true,
      identity: {
        guildId: input.guildId,
        userId: DiscordAccountIdSchema.parse(web.user.discordId),
      },
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      return {
        ok: false,
        status: statusForTrpcError(error),
        message: error.message,
      };
    }
    return { ok: false, status: 500, message: errorMessage(error) };
  }
}

function readWebCsrfContext(ctx: Context): {
  user: NonNullable<Context["user"]>;
  webSession: NonNullable<Context["webSession"]>;
} {
  if (ctx.webSession === null || ctx.user === null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Web session required — sign in at /app/login",
    });
  }
  return { user: ctx.user, webSession: ctx.webSession };
}

function assertWebCsrf(webSession: NonNullable<Context["webSession"]>): void {
  const { csrfToken, csrfHeader, origin } = webSession;
  if (
    csrfToken === null ||
    csrfHeader === null ||
    csrfToken.length === 0 ||
    csrfHeader.length === 0 ||
    csrfToken !== csrfHeader
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "CSRF token missing or mismatched",
    });
  }

  const expectedOrigin = configuration.webAppOrigin;
  if (expectedOrigin !== undefined && origin !== expectedOrigin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cross-origin request rejected",
    });
  }
}

function statusForTrpcError(error: TRPCError): number {
  if (error.code === "UNAUTHORIZED") {
    return 401;
  }
  if (error.code === "FORBIDDEN") {
    return 403;
  }
  if (error.code === "NOT_FOUND") {
    return 404;
  }
  if (error.code === "BAD_REQUEST") {
    return 400;
  }
  if (error.code === "TOO_MANY_REQUESTS") {
    return 429;
  }
  return 500;
}

function jsonError(
  message: string,
  status: number,
  corsHeaders: Record<string, string>,
  options: {
    retryAfterSeconds?: number | null;
    quota?: ReportAiQuotaSnapshot[] | null;
  } = {},
): Response {
  return Response.json(
    ReportAiHttpErrorSchema.parse({
      error: message,
      retryAfterSeconds: options.retryAfterSeconds ?? null,
      quota: options.quota ?? null,
    }),
    {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
