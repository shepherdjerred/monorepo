import * as Sentry from "@sentry/bun";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_INTERRUPTED_CAVEAT,
  EXPLORE_REQUEST_MAX_BYTES,
  EXPLORE_STOPPED_CAVEAT,
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
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
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
import { authenticateExploreRequest } from "#src/explore/http-auth.ts";
import { createLogger } from "#src/logger.ts";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";
import {
  scoutExploreActiveRuns,
  scoutExploreTurnDurationSeconds,
  scoutExploreTurnsTotal,
} from "#src/metrics/explore.ts";

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

  // Everything from here until the stream owns the ticket has to release it on
  // failure. `loadExploreTranscript` parses stored JSON and throws on a row
  // that does not match its schema, and the active-run counters are cleared
  // only by `ticket.finish()` — so one unreadable transcript would otherwise
  // wedge that user's slot, and eventually the global one, until restart.
  try {
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

    // The turn is valid and now running, so it is charged. Everything that can
    // reject a request — a bad target, an unreadable transcript — happens
    // above this line and leaves the quota untouched, so a caller cannot spend
    // the shared allowance on requests that never ran.
    ticket.commit();

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
  } catch (error) {
    // Idempotent, so the stream having already taken over is harmless.
    ticket.finish();
    scoutExploreTurnsTotal.inc({ status: "error" });
    logger.error("Failed to open an explore turn stream", errorMessage(error));
    Sentry.captureException(error, { tags: { source: "explore-turn-stream" } });
    return jsonError("Could not start this question.", 500, corsHeaders);
  }
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
    questionMessageId: started.messageId,
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
      // An interrupted turn keeps whatever it had already said — a deliberate
      // stop and a mid-stream failure alike. Discarding the prose would leave
      // a question with no answer under it, which reads as a bug rather than
      // as an interruption.
      //
      // A non-abort failure is a real error the client will only see as a
      // caveat (salvage emits `final`, not `error`), so the detail goes to
      // logs and Sentry here rather than vanishing entirely.
      if (!abortController.signal.aborted) {
        logger.error("Explore turn failed mid-stream", errorMessage(error));
        Sentry.captureException(error, {
          tags: { source: "explore-turn-run" },
        });
      }
      // Guarded on its own because this is a real database write inside a
      // catch block: a throw here would escape the catch, skip both terminal
      // events, and surface as an unhandled rejection from the voided async
      // runner. Salvage is best effort — the turn has already failed, so
      // failing to keep its remains must not also cost the caller its answer
      // about what happened.
      let salvaged: ExploreMessage | null = null;
      try {
        salvaged = await persistPartialAnswer(prisma, {
          aborted: abortController.signal.aborted,
          conversationId: started.conversationId,
          parentMessageId: started.messageId,
          text: streamedAnswer,
          trace,
        });
      } catch (salvageError) {
        logger.error(
          "Failed to salvage a stopped explore turn",
          errorMessage(salvageError),
        );
        Sentry.captureException(salvageError, {
          tags: { source: "explore-salvage" },
        });
      }
      if (salvaged === null) {
        emit({
          type: "error",
          message: clampMessage(errorMessage(error)),
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
 * `attach` is the attach point: `leaf` continues the branch on screen,
 * `message` forks a sibling under a named parent (an edit), `root` forks the
 * opening question, and a named message with no new text means answer it
 * again (a regenerate).
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
    if (input.conversationId === null || input.attach.kind !== "message") {
      throw new ExploreInvalidTurnError(
        "Answering again needs an existing question.",
      );
    }
    return await resolveRegenerateTarget(prisma, {
      conversationId: input.conversationId,
      userId: identity.userId,
      parentMessageId: input.attach.messageId,
    });
  }

  const started = await startExploreTurn(prisma, {
    conversationId: input.conversationId,
    userId: identity.userId,
    question: input.question,
    attach: input.attach,
  });
  return { ...started, question: input.question };
}

/**
 * Save what an interrupted turn had already produced — a deliberate stop or a
 * mid-stream failure, distinguished only by the caveat.
 *
 * Only refuses when there is no text: persisting an empty answer would just
 * put a blank bubble under the question. Exported with an explicit client so
 * tests can drive the salvage semantics without streaming a turn.
 */
export async function persistPartialAnswer(
  client: ExtendedPrismaClient,
  input: {
    aborted: boolean;
    conversationId: string;
    parentMessageId: string;
    text: string;
    trace: ExploreTraceEntry[];
  },
): Promise<ExploreMessage | null> {
  if (input.text.trim().length === 0) {
    return null;
  }
  return await appendExploreAnswer(client, {
    conversationId: input.conversationId,
    parentMessageId: input.parentMessageId,
    answer: {
      answer: clampAnswer(input.text),
      queryText: null,
      caveats: [
        input.aborted ? EXPLORE_STOPPED_CAVEAT : EXPLORE_INTERRUPTED_CAVEAT,
      ],
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
      // Clamped here rather than at each call site: this is the one place
      // every error response is built, so nothing can route around it.
      error: clampMessage(message),
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

/**
 * Fit a stopped turn's text inside the answer contract.
 *
 * Every answer the model produces arrives through `ExploreAnswerSchema`, which
 * caps length. A stopped turn does not: it hands a hand-built object to
 * `appendExploreAnswer`, which takes the plain type and writes straight to
 * Prisma, so nothing between here and the column would enforce the cap.
 *
 * Truncating rather than rejecting is the point — the text is what the person
 * stopped to keep. The caller has already refused an empty one, so the `min(1)`
 * end of the contract is covered.
 */
export function clampAnswer(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= EXPLORE_ANSWER_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, EXPLORE_ANSWER_MAX_LENGTH - 1)}…`;
}

/** The longest a message may be in `ExploreHttpErrorSchema` and the SSE error event. */
const MESSAGE_MAX_LENGTH = 1000;

/**
 * Fit a message inside the schema that will validate it.
 *
 * Both message fields are `.trim().min(1).max(1000)`, and both are parsed on
 * the way out — so an over-long message makes the *error response itself*
 * throw, turning a 400 into a crashed request. A Zod validation error grows
 * with the input, so a wide enough invalid body reaches that length on demand.
 * An empty message would fail `min(1)` just as hard, hence the fallback.
 */
function clampMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return "Request failed.";
  }
  if (trimmed.length <= MESSAGE_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
}
