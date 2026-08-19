import * as Sentry from "@sentry/bun";
import {
  EXPLORE_REQUEST_MAX_BYTES,
  ExploreHttpErrorSchema,
  ExploreShareTokenSchema,
  ExploreStreamEventSchema,
  ExploreTranscriptSchema,
  ExploreTurnRequestSchema,
  type ExploreMessage,
  type ExploreQuotaSnapshot,
  type ExploreStreamEvent,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  tryStartExploreTurn,
  type ExploreRateLimitIdentity,
  type ExploreRateLimitTicket,
} from "#src/explore/rate-limit.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
  loadExploreTranscript,
  loadSharedExploreTranscript,
  resolveRegenerateTarget,
  startExploreTurn,
} from "#src/explore/store.ts";
import { authenticateExploreRequest } from "#src/explore/http-auth.ts";
import {
  clampExploreMessage,
  runPersistedExploreTurn,
} from "#src/explore/run-turn.ts";
import { createLogger } from "#src/logger.ts";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";
import { scoutExploreTurnsTotal } from "#src/metrics/explore.ts";

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
 * The write end of one SSE response, and the only thing that knows whether it
 * is still writable.
 *
 * Exists because "closed" has two causes and only one of them is ours. The
 * runtime closes the controller when the client disconnects — a navigate-away,
 * a closed tab, switching conversations mid-turn — and a flag that only
 * recorded our own close left the teardown enqueueing into a dead controller.
 * `enqueue` throws synchronously there, and since the run is a voided async
 * IIFE that surfaced as an unhandled promise rejection rather than as anything
 * a caller could handle.
 *
 * So disconnection is recorded through {@link disconnected} and every write
 * goes through {@link emit}, which is a no-op once either side has closed.
 */
export function createSseWriter(
  controller: Pick<
    ReadableStreamDefaultController<Uint8Array>,
    "enqueue" | "close"
  >,
): {
  emit: (event: ExploreStreamEvent) => void;
  disconnected: () => void;
  finish: (event: ExploreStreamEvent) => void;
} {
  let closed = false;
  // Read through a function boundary: control-flow narrowing would otherwise
  // pin `closed` to its initializer, because every assignment happens inside a
  // closure TypeScript cannot see run.
  const isClosed = (): boolean => closed;

  return {
    emit: (event: ExploreStreamEvent): void => {
      if (isClosed()) {
        return;
      }
      const parsed = ExploreStreamEventSchema.parse(event);
      controller.enqueue(
        encoder.encode(
          `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
        ),
      );
    },
    disconnected: (): void => {
      closed = true;
    },
    /** Send a terminal event and close, unless the client already left. */
    finish: (event: ExploreStreamEvent): void => {
      if (isClosed()) {
        return;
      }
      const parsed = ExploreStreamEventSchema.parse(event);
      controller.enqueue(
        encoder.encode(
          `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
        ),
      );
      closed = true;
      controller.close();
    },
  };
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
  const writer = createSseWriter(controller);
  const abortFromRequest = () => {
    // Order matters: stop writing before unwinding the run, so nothing the
    // teardown emits can reach the controller the client just took away.
    writer.disconnected();
  };
  request.signal.addEventListener("abort", abortFromRequest);

  void (async () => {
    try {
      await runPersistedExploreTurn({
        ticket,
        identity,
        started,
        history,
        abortSignal: request.signal,
        emit: writer.emit,
      });
    } finally {
      request.signal.removeEventListener("abort", abortFromRequest);
      // A no-op if the client already left: there is nobody to send `done`
      // to, and closing a closed controller throws the same way enqueueing
      // does. The salvage write above is what matters for that case, and it
      // has already happened.
      writer.finish({ type: "done" });
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
      error: clampExploreMessage(message),
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
