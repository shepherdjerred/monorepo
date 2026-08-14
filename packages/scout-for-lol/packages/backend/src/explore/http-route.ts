import * as Sentry from "@sentry/bun";
import { TRPCError } from "@trpc/server";
import {
  DiscordAccountIdSchema,
  EXPLORE_REQUEST_MAX_BYTES,
  EXPLORE_TIMEOUT_MS,
  ExploreHttpErrorSchema,
  ExploreShareTokenSchema,
  ExploreStreamEventSchema,
  ExploreTranscriptSchema,
  ExploreTurnRequestSchema,
  type ExploreMessage,
  type ExploreQuotaSnapshot,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import { assertExploreAccess } from "#src/explore/access.ts";
import {
  getExploreQuotaStatus,
  tryStartExploreTurn,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
  appendExploreAnswer,
  loadExploreTranscript,
  loadSharedExploreTranscript,
  resolveRegenerateTarget,
  startExploreTurn,
} from "#src/explore/store.ts";
import { createLogger } from "#src/logger.ts";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";
import {
  scoutExploreActiveRuns,
  scoutExploreTurnDurationSeconds,
  scoutExploreTurnsTotal,
} from "#src/metrics/explore.ts";
import { createContext, type Context } from "#src/trpc/context.ts";

const STREAM_PATH = "/api/explore/stream";
const SHARED_PREFIX = "/api/explore/shared/";
const encoder = new TextEncoder();
const logger = createLogger("explore-http");

/**
 * Explore's HTTP surface.
 *
 * The turn endpoint streams over SSE because a turn runs tools for tens of
 * seconds and the transcript should fill in as it goes. The shared endpoint
 * is the only unauthenticated route in this file: it serves a stored
 * transcript to whoever holds the link.
 */
export async function handleExploreRoute(
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname.startsWith(SHARED_PREFIX)) {
    return await handleSharedTranscript(request, url, corsHeaders);
  }
  if (url.pathname !== STREAM_PATH) {
    return null;
  }
  if (request.method !== "POST") {
    return jsonError("Method not allowed.", 405, corsHeaders);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > EXPLORE_REQUEST_MAX_BYTES) {
    return jsonError("Request body is too large.", 413, corsHeaders);
  }
  const body = await readBodyWithinLimit(request, EXPLORE_REQUEST_MAX_BYTES);
  if (!body.ok) {
    return jsonError("Request body is too large.", 413, corsHeaders);
  }

  const parsedBody = parseRequestBody(body.text);
  if (!parsedBody.ok) {
    return jsonError(parsedBody.message, 400, corsHeaders);
  }

  const authResult = await authenticateExploreRequest(request);
  if (!authResult.ok) {
    return jsonError(authResult.message, authResult.status, corsHeaders);
  }

  const ticket = tryStartExploreTurn(authResult.identity, Date.now());
  if (!ticket.allowed) {
    scoutExploreTurnsTotal.inc({ status: "rate_limited" });
    return jsonError(ticket.reason, 429, corsHeaders, {
      quota: ticket.quota,
      retryAfterSeconds: ticket.retryAfterSeconds,
    });
  }

  // The question is persisted before the model runs, so an abandoned turn
  // still leaves a resumable conversation rather than losing what was asked.
  //
  // A null question means "answer this existing one again", so nothing new is
  // written — the fresh answer will simply become another child of it.
  let started: {
    conversationId: string;
    title: string;
    messageId: string;
    question: string;
  };
  try {
    started = await resolveTurnTarget(parsedBody.input, authResult.identity);
  } catch (error) {
    ticket.finish();
    scoutExploreTurnsTotal.inc({ status: "error" });
    if (error instanceof ExploreNotFoundError) {
      return jsonError(error.message, 404, corsHeaders);
    }
    if (error instanceof ExploreInvalidTurnError) {
      return jsonError(error.message, 400, corsHeaders);
    }
    // Anything else is a fault on our side — a database error, a broken
    // invariant. Report it as one and keep the detail in the logs instead of
    // telling the caller they asked for something that does not exist.
    logger.error("Failed to start an explore turn", errorMessage(error));
    Sentry.captureException(error, { tags: { source: "explore-turn-start" } });
    return jsonError("Could not start this question.", 500, corsHeaders);
  }

  // The path ending at the question being answered — which for an edit or a
  // regenerate is not the branch currently on screen.
  const history = await loadExploreTranscript(
    prisma,
    started.conversationId,
    authResult.identity.userId,
    started.messageId,
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      runExploreTurnStream({
        controller,
        request,
        ticket,
        identity: authResult.identity,
        started,
        history: history?.messages ?? [],
      });
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

/**
 * Run one turn onto an SSE controller.
 *
 * Extracted from the route handler purely so neither function is a wall of
 * code; the flow is linear and reads top to bottom.
 */
function runExploreTurnStream(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  request: Request;
  ticket: ExploreRateLimitTicket;
  identity: ExploreRateLimitIdentity;
  started: {
    conversationId: string;
    title: string;
    messageId: string;
    question: string;
  };
  history: ExploreMessage[];
}): void {
  const { controller, request, ticket, identity, started, history } = input;
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort("Explore turn timed out.");
  }, EXPLORE_TIMEOUT_MS);
  const abortFromRequest = () => {
    abortController.abort("Client disconnected.");
  };
  request.signal.addEventListener("abort", abortFromRequest);
  let closed = false;
  let runStatus = "error";
  const startedAt = Date.now();
  scoutExploreActiveRuns.inc();

  const emit = (event: ExploreStreamEvent): void => {
    if (closed) {
      return;
    }
    const parsed = ExploreStreamEventSchema.parse(event);
    controller.enqueue(
      encoder.encode(
        `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
      ),
    );
  };

  emit({
    type: "started",
    runId: ticket.runId,
    conversationId: started.conversationId,
  });

  // Accumulated as the run goes so a stopped turn can still be saved, and
  // so the finished answer carries the trace the reasoning panel shows.
  const trace: ExploreTraceEntry[] = [];
  let streamedAnswer = "";
  const record = (event: ExploreStreamEvent): void => {
    if (event.type === "answer_delta") {
      streamedAnswer += event.text;
    }
    if (event.type === "tool_result") {
      trace.push({
        toolName: event.toolName,
        message: event.message,
        ok: event.ok,
      });
    }
    emit(event);
  };

  void (async () => {
    try {
      const result = await streamExploreAgent({
        runId: ticket.runId,
        question: started.question,
        // Drop the question itself — the agent receives it as the current
        // turn, and replaying it would duplicate it.
        history: history.slice(0, -1),
        abortSignal: abortController.signal,
        emit: record,
      });
      const message = await appendExploreAnswer(prisma, {
        conversationId: started.conversationId,
        parentMessageId: started.messageId,
        answer: result.answer,
        preview: result.preview,
        visualization: result.visualization,
        trace,
      });
      ticket.finish();
      runStatus = "success";
      emit({
        type: "final",
        message,
        title: started.title,
        quota: getExploreQuotaStatus(identity, Date.now()).quota,
      });
    } catch (error) {
      runStatus = abortController.signal.aborted ? "cancelled" : "error";
      // A stopped turn keeps whatever it had already said. Discarding it
      // would leave a question with no answer under it, which reads as a
      // bug rather than as a deliberate stop.
      const salvaged = await persistPartialAnswer({
        aborted: abortController.signal.aborted,
        conversationId: started.conversationId,
        parentMessageId: started.messageId,
        text: streamedAnswer,
        trace,
      });
      if (salvaged === null) {
        emit({
          type: "error",
          message: errorMessage(error),
          retryAfterSeconds: null,
          quota: getExploreQuotaStatus(identity, Date.now()).quota,
        });
      } else {
        emit({
          type: "final",
          message: salvaged,
          title: started.title,
          quota: getExploreQuotaStatus(identity, Date.now()).quota,
        });
      }
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromRequest);
      ticket.finish();
      scoutExploreActiveRuns.dec();
      scoutExploreTurnsTotal.inc({ status: runStatus });
      scoutExploreTurnDurationSeconds
        .labels(runStatus)
        .observe((Date.now() - startedAt) / 1000);
      emit({ type: "done" });
      closed = true;
      controller.close();
    }
  })();
}

/**
 * Serve a shared transcript to an anonymous caller.
 *
 * No session, no CSRF, and no query execution: the token is the credential
 * and the stored turns are the whole answer.
 *
 * Not cacheable, despite being anonymous and cheap. The token is the only
 * credential, so revoking a share has to stop resolving it immediately — a
 * cached copy would keep serving a withdrawn conversation for the life of its
 * TTL to exactly the people the owner just cut off. Nor is the content fixed
 * for a given token: sharing again re-pins `sharedLeafId` to whatever the
 * owner is reading now, so the same link can legitimately answer differently
 * before and after.
 */
async function handleSharedTranscript(
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonError("Method not allowed.", 405, corsHeaders);
  }
  const rawToken = url.pathname.slice(SHARED_PREFIX.length);
  const token = ExploreShareTokenSchema.safeParse(rawToken);
  if (!token.success) {
    return jsonError("Not found.", 404, corsHeaders);
  }
  const transcript = await loadSharedExploreTranscript(prisma, token.data);
  if (transcript === null) {
    return jsonError("Not found.", 404, corsHeaders);
  }
  return Response.json(ExploreTranscriptSchema.parse(transcript), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

/**
 * Work out which question this turn answers, creating it when the request
 * carries new text.
 *
 * `parentMessageId` is the attach point: null continues the branch on screen,
 * an existing question's parent forks a sibling (an edit), and the question
 * itself with no new text means answer it again (a regenerate).
 */
async function resolveTurnTarget(
  input: ExploreTurnRequest,
  identity: ExploreRateLimitIdentity,
): Promise<{
  conversationId: string;
  title: string;
  messageId: string;
  question: string;
}> {
  if (input.question === null) {
    if (input.conversationId === null || input.parentMessageId === null) {
      throw new ExploreInvalidTurnError(
        "Answering again needs an existing question.",
      );
    }
    return await resolveRegenerateTarget(prisma, {
      conversationId: input.conversationId,
      userId: identity.userId,
      parentMessageId: input.parentMessageId,
    });
  }

  const started = await startExploreTurn(prisma, {
    conversationId: input.conversationId,
    userId: identity.userId,
    question: input.question,
    parentMessageId: input.parentMessageId,
  });
  return { ...started, question: input.question };
}

/**
 * Save what a stopped turn had already produced.
 *
 * Only for a deliberate stop with text in hand: a turn that failed outright
 * has nothing worth keeping, and persisting an empty answer would just put a
 * blank bubble under the question.
 */
async function persistPartialAnswer(input: {
  aborted: boolean;
  conversationId: string;
  parentMessageId: string;
  text: string;
  trace: ExploreTraceEntry[];
}): Promise<ExploreMessage | null> {
  if (!input.aborted || input.text.trim().length === 0) {
    return null;
  }
  return await appendExploreAnswer(prisma, {
    conversationId: input.conversationId,
    parentMessageId: input.parentMessageId,
    answer: {
      answer: input.text,
      queryText: null,
      caveats: ["This answer was stopped before it finished."],
      followUps: [],
    },
    preview: null,
    visualization: null,
    trace: input.trace,
  });
}

type ParsedRequestBody =
  | { ok: true; input: ExploreTurnRequest }
  | { ok: false; message: string };

function parseRequestBody(bodyText: string): ParsedRequestBody {
  try {
    const raw: unknown = JSON.parse(bodyText);
    const parsed = ExploreTurnRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message };
    }
    return { ok: true, input: parsed.data };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

type AuthResult =
  | { ok: true; identity: ExploreRateLimitIdentity }
  | { ok: false; status: number; message: string };

async function authenticateExploreRequest(
  request: Request,
): Promise<AuthResult> {
  try {
    const ctx = await createContext(request);
    const web = readWebCsrfContext(ctx);
    assertWebCsrf(web.webSession);
    await assertExploreAccess(web.user);
    return {
      ok: true,
      identity: {
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
      message: "Sign in to use explore.",
    });
  }
  return { user: ctx.user, webSession: ctx.webSession };
}

function assertWebCsrf(webSession: NonNullable<Context["webSession"]>): void {
  const { csrfToken, csrfHeader, origin } = webSession;
  if (
    csrfToken === null ||
    csrfHeader === null ||
    csrfToken !== csrfHeader ||
    csrfToken.length === 0 ||
    csrfHeader.length === 0
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
    quota?: ExploreQuotaSnapshot[] | null;
  } = {},
): Response {
  return Response.json(
    ExploreHttpErrorSchema.parse({
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
