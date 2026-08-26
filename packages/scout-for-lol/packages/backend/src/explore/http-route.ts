import {
  EXPLORE_REQUEST_MAX_BYTES,
  ExploreHttpErrorSchema,
  ExploreRunObserveRequestSchema,
  ExploreShareTokenSchema,
  ExploreStreamEventSchema,
  type ExploreQuotaSnapshot,
  type ExploreRunObserveRequest,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { authenticateExploreRequest } from "#src/explore/http-auth.ts";
import { exploreRunManager } from "#src/explore/run-manager.ts";
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
  };
  const subscription = await exploreRunManager.subscribeDurable(
    parsedBody.input.runId,
    authResult.identity.userId,
    (event) => {
      if (event.type === "done") {
        request.signal.removeEventListener("abort", detach);
        unsubscribe();
        writer.finish(event);
      } else {
        writer.emit(event);
      }
    },
  );
  if (subscription === null) {
    writer.disconnected();
    observerBody.controller.close();
    return jsonError("Run not found.", 404, corsHeaders);
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
      ...corsHeaders,
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
  return Response.json(redactSharedExploreTranscript(transcript), {
    status: 200,
    headers: { "Cache-Control": "no-store", ...corsHeaders },
  });
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
  if (trimmed.length <= MESSAGE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
