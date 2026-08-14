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
  type ExploreQuotaSnapshot,
  type ExploreStreamEvent,
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
} from "#src/explore/rate-limit.ts";
import {
  appendExploreAnswer,
  loadExploreTranscript,
  loadSharedExploreTranscript,
  startExploreTurn,
} from "#src/explore/store.ts";
import {
  scoutExploreActiveRuns,
  scoutExploreTurnDurationSeconds,
  scoutExploreTurnsTotal,
} from "#src/metrics/explore.ts";
import { createContext, type Context } from "#src/trpc/context.ts";

const STREAM_PATH = "/api/explore/stream";
const SHARED_PREFIX = "/api/explore/shared/";
const encoder = new TextEncoder();

/**
 * Explore's HTTP surface.
 *
 * The turn endpoint streams over SSE because a turn runs tools for tens of
 * seconds and the transcript should fill in as it goes. The shared endpoint
 * is the only unauthenticated route in this file: it serves a frozen
 * transcript to whoever holds the link, so it is publicly cacheable — unlike
 * every authenticated response, which is not.
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
  const bodyText = await request.text();
  if (encoder.encode(bodyText).byteLength > EXPLORE_REQUEST_MAX_BYTES) {
    return jsonError("Request body is too large.", 413, corsHeaders);
  }

  const parsedBody = parseRequestBody(bodyText);
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
  let started: { conversationId: string; title: string; ordinal: number };
  try {
    started = await startExploreTurn(prisma, {
      conversationId: parsedBody.input.conversationId,
      userId: authResult.identity.userId,
      question: parsedBody.input.question,
    });
  } catch (error) {
    ticket.finish();
    scoutExploreTurnsTotal.inc({ status: "error" });
    return jsonError(errorMessage(error), 404, corsHeaders);
  }

  const history = await loadExploreTranscript(
    prisma,
    started.conversationId,
    authResult.identity.userId,
  );

  const stream = new ReadableStream({
    start(controller) {
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

      void (async () => {
        try {
          const result = await streamExploreAgent({
            runId: ticket.runId,
            question: parsedBody.input.question,
            // Drop the question just written — the agent receives it as the
            // current turn, and replaying it would duplicate it.
            history: (history?.messages ?? []).slice(0, -1),
            abortSignal: abortController.signal,
            emit,
          });
          const message = await appendExploreAnswer(prisma, {
            conversationId: started.conversationId,
            ordinal: started.ordinal + 1,
            answer: result.answer,
            preview: result.preview,
            visualization: result.visualization,
          });
          ticket.finish();
          runStatus = "success";
          emit({
            type: "final",
            message,
            title: started.title,
            quota: getExploreQuotaStatus(authResult.identity, Date.now()).quota,
          });
        } catch (error) {
          runStatus = abortController.signal.aborted ? "cancelled" : "error";
          emit({
            type: "error",
            message: errorMessage(error),
            retryAfterSeconds: null,
            quota: getExploreQuotaStatus(authResult.identity, Date.now()).quota,
          });
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
 * Serve a frozen shared transcript to an anonymous caller.
 *
 * No session, no CSRF, and no query execution: the token is the credential
 * and the stored turns are the whole answer. Publicly cacheable because the
 * content cannot change without the owner minting a new token.
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
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
    },
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
