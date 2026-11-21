import {
  EXPLORE_REQUEST_MAX_BYTES,
  ExploreHttpErrorSchema,
  ExploreRunObserveRequestSchema,
  ExploreShareTokenSchema,
  ExploreStreamEventSchema,
  type DiscordAccountId,
  type ExploreQuotaSnapshot,
  type ExploreRunObserveRequest,
  type ExploreStreamEvent,
  withoutUnknownEffort,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { authenticateExploreRequest } from "#src/explore/http/http-auth.ts";
import { exploreRunManager } from "#src/explore/runs/run-manager.ts";
import { loadSharedExploreTranscript } from "#src/explore/store.ts";
import { redactSharedExploreTranscript } from "#src/explore/trace.ts";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";

export const EXPLORE_STREAM_PATH = "/api/explore/stream";
const SHARED_PREFIX = "/api/explore/shared/";
const encoder = new TextEncoder();

/**
 * Explore's HTTP surface.
 *
 * Starting, listing, and stopping runs are authenticated tRPC procedures.
 * This endpoint only observes a server-owned run, so losing its response
 * detaches one browser without cancelling the model. Shared transcripts stay
 * as the one anonymous read.
 */
export async function handleExploreRoute(
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname.startsWith(SHARED_PREFIX)) {
    return await handleSharedTranscript(request, url, corsHeaders);
  }
  if (url.pathname !== EXPLORE_STREAM_PATH) {
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

  const observed = await observeExploreRun({
    request,
    runId: parsedBody.input.runId,
    userId: authResult.identity.userId,
    headers: corsHeaders,
  });
  return observed ?? jsonError("Run not found.", 404, corsHeaders);
}

/**
 * Attach one observer to a server-owned run and answer with its SSE stream,
 * or null when the caller owns no such run.
 *
 * The browser's `/api/explore/stream` and Scout Desktop's `runs/stream` both
 * answer through this, so the two surfaces read one event model: the
 * snapshot on attach, then live events, then `done`. Losing the response
 * detaches this observer only; the run keeps going.
 *
 * `onDetach` runs exactly once, when the stream ends for any reason, so a
 * caller can hold a per-observer resource (Scout Desktop's per-device
 * observer cap) for precisely the stream's lifetime.
 */
export async function observeExploreRun(input: {
  request: Request;
  runId: string;
  userId: DiscordAccountId;
  headers: Record<string, string>;
  onDetach?: () => void;
}): Promise<Response | null> {
  const { request } = input;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    input.onDetach?.();
  };
  let disconnect = noop;
  const observerBody = createObserverBody(() => {
    disconnect();
  });
  const writer = createSseWriter(observerBody.controller);
  let unsubscribe = noop;
  const detach = (): void => {
    request.signal.removeEventListener("abort", detach);
    unsubscribe();
    writer.disconnected();
    release();
  };
  let subscription: (() => void) | null;
  try {
    subscription = await exploreRunManager.subscribeDurable(
      input.runId,
      input.userId,
      (event) => {
        if (event.type === "done") {
          request.signal.removeEventListener("abort", detach);
          unsubscribe();
          writer.finish(event);
          release();
        } else {
          writer.emit(event);
        }
      },
    );
  } catch (error) {
    writer.disconnected();
    release();
    throw error;
  }
  if (subscription === null) {
    writer.disconnected();
    observerBody.controller.close();
    release();
    return null;
  }
  unsubscribe = subscription;
  disconnect = detach;
  request.signal.addEventListener("abort", detach, { once: true });
  if (request.signal.aborted) detach();

  return new Response(observerBody.stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...input.headers,
    },
  });
}

function createObserverBody(onCancel: () => void): {
  stream: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
} {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllers.push(controller);
    },
    cancel() {
      onCancel();
    },
  });
  const controller = controllers[0];
  if (controller === undefined) {
    throw new Error("Explore observer stream did not initialize.");
  }
  return { stream, controller };
}

function noop(): void {
  // Assigned until the observer subscription has been attached.
}

/** A guarded SSE writer that tolerates a browser disappearing mid-event. */
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
  const isClosed = (): boolean => closed;
  const enqueue = (event: ExploreStreamEvent): void => {
    const parsed = ExploreStreamEventSchema.parse(event);
    controller.enqueue(
      encoder.encode(
        `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
      ),
    );
  };

  return {
    emit: (event): void => {
      if (!isClosed()) enqueue(event);
    },
    disconnected: (): void => {
      closed = true;
    },
    finish: (event): void => {
      if (isClosed()) return;
      enqueue(event);
      closed = true;
      controller.close();
    },
  };
}

async function handleSharedTranscript(
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonError("Method not allowed.", 405, corsHeaders);
  }
  const token = ExploreShareTokenSchema.safeParse(
    url.pathname.slice(SHARED_PREFIX.length),
  );
  if (!token.success) {
    return jsonError("Not found.", 404, corsHeaders);
  }
  const transcript = await loadSharedExploreTranscript(prisma, token.data);
  if (transcript === null) {
    return jsonError("Not found.", 404, corsHeaders);
  }
  const shared = redactSharedExploreTranscript(transcript);
  return Response.json(
    shapeSharedTranscript(shared, url.searchParams.get("cards")),
    {
      status: 200,
      headers: { "Cache-Control": "no-store", ...corsHeaders },
    },
  );
}

/**
 * The anonymous wire shape for one reader generation, named by `?cards=`.
 * `cards=4` readers parse `low` reasoning effort; every older reader (and a
 * bare request) parses effort strictly as `high`, so an answer written at
 * another effort reaches them without its provenance.
 */
export function shapeSharedTranscript(
  shared: ReturnType<typeof redactSharedExploreTranscript>,
  cardsVersion: string | null,
) {
  // Keep the anonymous endpoint on its pre-origin wire shape. A cached SPA
  // bundle parses this response strictly and would reject a newly added key;
  // current clients default an absent origin to `legacy`.
  //
  // `guildIds` is the same hazard one level down. Redaction empties it so no
  // guild can leak onto a public link, but an empty array still serializes the
  // key, and `fetchSharedTranscript` parses each message strictly — so a share
  // link would fail to load in every tab running a pre-deploy bundle. The key
  // is dropped here rather than emptied.
  const compatibleShared = {
    ...shared,
    messages: shared.messages.map((original) => {
      const message =
        cardsVersion === "4" ? original : withoutUnknownEffort(original);
      // Shared transcripts never carry images (they are served only to their
      // owner), so the key is dropped for the same pre-deploy-bundle reason.
      const {
        guildIds: _guildIds,
        attachments: _attachments,
        ...rest
      } = message;
      if (cardsVersion === "3" || cardsVersion === "4") return rest;
      const {
        generation: _generation,
        inlineEntities: _entities,
        ...legacy
      } = rest;
      return {
        ...legacy,
        trace: legacy.trace.map((entry) => ({
          ...entry,
          rawInput: null,
          rawOutput: null,
        })),
      };
    }),
    conversation: {
      id: shared.conversation.id,
      title: shared.conversation.title,
      shareToken: shared.conversation.shareToken,
      sharedLeafId: shared.conversation.sharedLeafId,
      createdAt: shared.conversation.createdAt,
      updatedAt: shared.conversation.updatedAt,
    },
  };
  return cardsVersion === "2" || cardsVersion === "3" || cardsVersion === "4"
    ? compatibleShared
    : {
        ...compatibleShared,
        messages: compatibleShared.messages.map((message) => {
          if (cardsVersion === "1") {
            const { loadoutCards: _loadoutCards, ...legacyMessage } = message;
            return legacyMessage;
          }
          const {
            matchCards: _matchCards,
            loadoutCards: _loadoutCards,
            ...messageWithoutCards
          } = message;
          return messageWithoutCards;
        }),
      };
}

type ParsedRequestBody =
  | { ok: true; input: ExploreRunObserveRequest }
  | { ok: false; message: string };

function parseRequestBody(bodyText: string): ParsedRequestBody {
  try {
    const raw: unknown = JSON.parse(bodyText);
    const parsed = ExploreRunObserveRequestSchema.safeParse(raw);
    return parsed.success
      ? { ok: true, input: parsed.data }
      : { ok: false, message: parsed.error.message };
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

const MESSAGE_MAX_LENGTH = 1000;

function clampMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "Request failed.";
  return trimmed.length <= MESSAGE_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
