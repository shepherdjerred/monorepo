import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  decompressEnvelopePayload,
  MalformedEnvelopeError,
  MAX_COMPRESSED_BYTES,
  PayloadTooLargeError,
  parseSentryEnvelope,
  type ParsedEnvelopeResult,
} from "#domain/envelope.ts";
import {
  createIngestRateLimiter,
  type IngestRateLimiter,
} from "#domain/rate-limit.ts";
import {
  constantTimeStringEquals,
  parsePositiveIntId,
} from "#infrastructure/repository-helpers.ts";
import type { ErrorsRepository } from "#infrastructure/repository-types.ts";
import {
  createErrorsMetrics,
  traceRequest,
  type ErrorsMetrics,
} from "#infrastructure/telemetry.ts";

export type IngestAppDeps = {
  readonly repo: ErrorsRepository;
  readonly ingestEnabled?: (() => Promise<boolean>) | undefined;
  readonly rateLimiter?: IngestRateLimiter | undefined;
  readonly metrics?: ErrorsMetrics | undefined;
  readonly onOutboxQueued?: (() => void) | undefined;
};

const INGEST_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Content-Encoding, X-Sentry-Auth, Authorization, Baggage, Sentry-Trace",
  "Access-Control-Expose-Headers": "X-Sentry-Rate-Limits, Retry-After",
  "Access-Control-Max-Age": "86400",
};

function applyCorsHeaders(c: Context): void {
  for (const [key, value] of Object.entries(INGEST_CORS_HEADERS)) {
    c.header(key, value);
  }
}

function extractClientIp(c: Context): string {
  const cfIp = c.req.header("CF-Connecting-IP")?.trim();
  if (cfIp !== undefined && cfIp.length > 0) {
    return cfIp;
  }
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded !== undefined) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  const realIp = c.req.header("X-Real-IP")?.trim();
  return realIp !== undefined && realIp.length > 0 ? realIp : "unknown";
}

function concatByteChunks(
  chunks: readonly Uint8Array[],
  totalBytes: number,
): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const part of chunks) {
    combined.set(part, cursor);
    cursor += part.byteLength;
  }
  return combined;
}

async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLengthRaw = request.headers.get("Content-Length")?.trim();
  if (
    contentLengthRaw !== undefined &&
    /^\d+$/u.test(contentLengthRaw) &&
    Number.parseInt(contentLengthRaw, 10) > maxBytes
  ) {
    throw new PayloadTooLargeError(
      "Content-Length exceeds 1 MiB envelope limit.",
    );
  }

  if (request.body === null) {
    return new Uint8Array(0);
  }

  const collected: Uint8Array[] = [];
  let seenBytes = 0;
  for await (const chunk of request.body) {
    seenBytes += chunk.byteLength;
    if (seenBytes > maxBytes) {
      throw new PayloadTooLargeError(
        "Compressed envelope payload exceeds 1 MiB limit.",
      );
    }
    collected.push(chunk);
  }

  return concatByteChunks(collected, seenBytes);
}

export type ResolvedIngestRuntime = {
  readonly repo: ErrorsRepository;
  readonly ingestEnabled: () => Promise<boolean>;
  readonly rateLimiter: IngestRateLimiter;
  readonly metrics: ErrorsMetrics;
  readonly onOutboxQueued?: (() => void) | undefined;
};

export function resolveIngestRuntime(
  deps: IngestAppDeps,
): ResolvedIngestRuntime {
  return {
    repo: deps.repo,
    ingestEnabled: deps.ingestEnabled ?? (() => Promise.resolve(true)),
    rateLimiter: deps.rateLimiter ?? createIngestRateLimiter(),
    metrics: deps.metrics ?? createErrorsMetrics(),
    onOutboxQueued: deps.onOutboxQueued,
  };
}

export function handleEnvelopeOptions(c: Context): Response {
  applyCorsHeaders(c);
  return c.body(null, 204);
}

async function decodeIncomingEnvelope(
  c: Context,
  metrics: ErrorsMetrics,
): Promise<
  | { readonly ok: true; readonly parsed: ParsedEnvelopeResult }
  | { readonly ok: false; readonly response: Response }
> {
  try {
    const rawBytes = await readBoundedRequestBody(
      c.req.raw,
      MAX_COMPRESSED_BYTES,
    );
    const decompressed = decompressEnvelopePayload(
      rawBytes,
      c.req.header("Content-Encoding"),
    );
    const parsed = parseSentryEnvelope(decompressed, {
      sentryAuthHeader: c.req.header("X-Sentry-Auth"),
      authorizationHeader: c.req.header("Authorization"),
      querySentryKey: c.req.query("sentry_key"),
      contentType: c.req.header("Content-Type"),
    });
    return { ok: true, parsed };
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      metrics.ingestEventsTotal.inc({ status: "rejected" });
      return {
        ok: false,
        response: c.json({ error: "payload_too_large" }, 413),
      };
    }
    if (error instanceof MalformedEnvelopeError) {
      metrics.ingestEventsTotal.inc({ status: "rejected" });
      return {
        ok: false,
        response: c.json(
          { error: "malformed_envelope", detail: error.message },
          400,
        ),
      };
    }
    throw error;
  }
}

async function handleNonEventEnvelope(
  c: Context,
  runtime: ResolvedIngestRuntime,
  projectId: number,
  parsedEnvelope: ParsedEnvelopeResult,
): Promise<Response> {
  const project = await runtime.repo.getProject(projectId);
  if (
    project === null ||
    parsedEnvelope.publicKey === null ||
    !constantTimeStringEquals(project.publicKey, parsedEnvelope.publicKey)
  ) {
    runtime.metrics.ingestEventsTotal.inc({ status: "unauthorized" });
    return c.json({ error: "unauthorized" }, 401);
  }
  runtime.metrics.ingestEventsTotal.inc({ status: "ignored" });
  return c.json(
    { id: null, ignoredItemTypes: parsedEnvelope.ignoredItemTypes },
    200,
  );
}

export async function handleEnvelopePost(
  c: Context,
  runtime: ResolvedIngestRuntime,
): Promise<Response> {
  applyCorsHeaders(c);

  if (!(await runtime.ingestEnabled())) {
    runtime.metrics.ingestEventsTotal.inc({ status: "disabled" });
    return c.json({ error: "ingest_disabled" }, 503);
  }

  const projectId = parsePositiveIntId(c.req.param("projectId") ?? "");
  if (projectId === null) {
    runtime.metrics.ingestEventsTotal.inc({ status: "rejected" });
    return c.json({ error: "invalid_project_id" }, 400);
  }

  const rateDecision = runtime.rateLimiter.consume({
    projectId,
    ip: extractClientIp(c),
  });
  if (!rateDecision.allowed) {
    runtime.metrics.ingestEventsTotal.inc({ status: "rate_limited" });
    c.header("Retry-After", String(rateDecision.retryAfterSeconds));
    c.header("X-Sentry-Rate-Limits", rateDecision.rateLimitHeader);
    return c.json({ error: "rate_limited" }, 429);
  }

  const decoded = await decodeIncomingEnvelope(c, runtime.metrics);
  if (!decoded.ok) {
    return decoded.response;
  }
  const { parsed } = decoded;
  if (parsed.publicKey === null) {
    runtime.metrics.ingestEventsTotal.inc({ status: "unauthorized" });
    return c.json({ error: "missing_public_key" }, 401);
  }
  if (parsed.event === null) {
    return handleNonEventEnvelope(c, runtime, projectId, parsed);
  }

  const outcome = await runtime.repo.ingestEvent({
    projectId,
    publicKey: parsed.publicKey,
    normalizedEvent: parsed.event,
  });

  if (outcome.status === "unauthorized") {
    runtime.metrics.ingestEventsTotal.inc({ status: "unauthorized" });
    return c.json({ error: "unauthorized" }, 401);
  }
  if (outcome.status === "duplicate") {
    runtime.metrics.ingestEventsTotal.inc({ status: "duplicate" });
    return c.json({ id: outcome.eventId, duplicate: true }, 200);
  }

  runtime.metrics.ingestEventsTotal.inc({ status: "accepted" });
  if (outcome.outboxId !== null && runtime.onOutboxQueued !== undefined) {
    runtime.onOutboxQueued();
  }
  return c.json({ id: outcome.eventId }, 200);
}

export function createIngestApp(deps: IngestAppDeps): Hono {
  const app = new Hono();
  const runtime = resolveIngestRuntime(deps);

  app.use(secureHeaders());
  app.use(async (c, next) => {
    const route =
      c.req.path === "/healthz" ? "/healthz" : "/api/:projectId/envelope";
    await traceRequest(c.req.raw, route, next);
  });

  app.get("/healthz", (c) => c.text("ok", 200));

  app.options("/api/:projectId/envelope", (c) => handleEnvelopeOptions(c));
  app.options("/api/:projectId/envelope/", (c) => handleEnvelopeOptions(c));
  app.post("/api/:projectId/envelope", (c) => handleEnvelopePost(c, runtime));
  app.post("/api/:projectId/envelope/", (c) => handleEnvelopePost(c, runtime));

  app.all("*", (c) => c.json({ error: "not_found" }, 404));

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        message: "errors_ingest_request_failed",
        path: c.req.path,
        error: error.message,
      }),
    );
    return c.json({ error: "internal_server_error" }, 500);
  });

  return app;
}
