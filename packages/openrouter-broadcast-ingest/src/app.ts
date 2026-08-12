import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import type { BroadcastArchiveStore } from "./archive.ts";
import type { BroadcastConfig } from "./config.ts";
import type { TempoForwarder } from "./forwarder.ts";
import type { BroadcastMetrics } from "./metrics.ts";
import {
  OtlpJsonPayloadSchema,
  redactOtlpPayload,
  slimOtlpPayload,
  summarizeOtlpPayload,
  type OtlpJsonPayload,
} from "./otlp.ts";

export type BroadcastLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};

export type BroadcastAppDependencies = {
  archive: BroadcastArchiveStore;
  forwarder: TempoForwarder;
  logger: BroadcastLogger;
  metrics: BroadcastMetrics;
  now?: (() => Date) | undefined;
};

type ProcessingPhase = "archive" | "forward";

class PayloadTooLargeError extends Error {}
class InvalidJsonError extends Error {}

class BroadcastProcessingError extends Error {
  readonly phase: ProcessingPhase;

  constructor(phase: ProcessingPhase, cause: unknown) {
    super(
      `${phase} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "BroadcastProcessingError";
    this.phase = phase;
  }
}

type DeliveryResult = {
  digest: string;
  duplicate: boolean;
  payloadKey: string;
};

function writeLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    message,
    service: "openrouter-broadcast-ingest",
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else process.stdout.write(`${line}\n`);
}

function jsonLogger(): BroadcastLogger {
  return {
    error: (message, fields) => {
      writeLog("error", message, fields);
    },
    info: (message, fields) => {
      writeLog("info", message, fields);
    },
    warn: (message, fields) => {
      writeLog("warn", message, fields);
    },
  };
}

export function createBroadcastLogger(): BroadcastLogger {
  return jsonLogger();
}

function bearerToken(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) === true
    ? header.slice(prefix.length)
    : undefined;
}

function bearerMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) return false;
  const actualHash = createHash("sha256").update(presented).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function readBoundedBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ bytes: number; text: string }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isInteger(contentLength) || contentLength < 0) {
      throw new InvalidJsonError("invalid Content-Length");
    }
    if (contentLength > maxBodyBytes) throw new PayloadTooLargeError();
  }

  if (request.body === null) return { bytes: 0, text: "" };
  const reader = request.body.getReader();
  const ReadResultSchema = z.object({
    done: z.boolean(),
    value: z.instanceof(Uint8Array).optional(),
  });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let done = false;
  while (!done) {
    const result = ReadResultSchema.parse(await reader.read());
    done = result.done;
    if (done) continue;
    const chunk = result.value;
    if (chunk === undefined) {
      throw new InvalidJsonError("request stream returned no bytes");
    }
    bytes += chunk.byteLength;
    if (bytes > maxBodyBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(chunk);
  }
  return {
    bytes,
    text: Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      bytes,
    ).toString("utf8"),
  };
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    throw new InvalidJsonError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function datePath(date: Date): string {
  return [
    date.getUTCFullYear().toString(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("/");
}

function archiveKeys(
  prefix: string,
  digest: string,
  date: Date,
): { payloadKey: string; receiptKey: string } {
  const base = `${prefix}/openrouter-broadcast`;
  const path = datePath(date);
  return {
    payloadKey: `${base}/payloads/${path}/${digest}.json.gz`,
    receiptKey: `${base}/receipts/${digest}.json.gz`,
  };
}

function processingError(phase: ProcessingPhase, error: unknown): never {
  if (error instanceof BroadcastProcessingError) throw error;
  throw new BroadcastProcessingError(phase, error);
}

function createDeliveryProcessor(
  config: BroadcastConfig,
  dependencies: BroadcastAppDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<DeliveryResult>>();

  const deliverOnce = async (
    payload: OtlpJsonPayload,
    redactedJson: string,
    digest: string,
  ): Promise<DeliveryResult> => {
    const keys = archiveKeys(config.archive.prefix, digest, now());
    try {
      if (await dependencies.archive.exists(keys.receiptKey)) {
        dependencies.metrics.operationsTotal.inc({
          operation: "duplicate",
          outcome: "detected",
        });
        return { digest, duplicate: true, payloadKey: keys.payloadKey };
      }
      if (!(await dependencies.archive.exists(keys.payloadKey))) {
        await dependencies.archive.put(keys.payloadKey, redactedJson);
      }
      dependencies.metrics.operationsTotal.inc({
        operation: "archive",
        outcome: "success",
      });
    } catch (error) {
      dependencies.metrics.operationsTotal.inc({
        operation: "archive",
        outcome: "error",
      });
      processingError("archive", error);
    }

    try {
      await dependencies.forwarder.forward(
        JSON.stringify(slimOtlpPayload(payload)),
      );
      dependencies.metrics.operationsTotal.inc({
        operation: "forward",
        outcome: "success",
      });
    } catch (error) {
      dependencies.metrics.operationsTotal.inc({
        operation: "forward",
        outcome: "error",
      });
      processingError("forward", error);
    }

    try {
      await dependencies.archive.put(
        keys.receiptKey,
        JSON.stringify({
          digest,
          forwardedAt: now().toISOString(),
          payloadKey: keys.payloadKey,
          version: 1,
        }),
      );
    } catch (error) {
      dependencies.metrics.operationsTotal.inc({
        operation: "archive",
        outcome: "error",
      });
      // The forward already succeeded. Reporting this as a delivery failure
      // would make the sender retry a payload Tempo has, and the retry would
      // forward it a second time. The receipt only suppresses later duplicates,
      // so a lost receipt costs deduplication for this digest, never delivery.
      dependencies.logger.warn("Broadcast receipt write failed after forward", {
        digest,
        error: error instanceof Error ? error.message : String(error),
        receiptKey: keys.receiptKey,
      });
    }
    return { digest, duplicate: false, payloadKey: keys.payloadKey };
  };

  return async (payload: OtlpJsonPayload): Promise<DeliveryResult> => {
    const redacted = OtlpJsonPayloadSchema.parse(
      redactOtlpPayload(payload, config.bearerToken),
    );
    const redactedJson = JSON.stringify(redacted);
    const digest = createHash("sha256").update(redactedJson).digest("hex");
    const existing = inFlight.get(digest);
    if (existing !== undefined) {
      const result = await existing;
      dependencies.metrics.operationsTotal.inc({
        operation: "duplicate",
        outcome: "in_flight",
      });
      return { ...result, duplicate: true };
    }

    const delivery = deliverOnce(redacted, redactedJson, digest);
    inFlight.set(digest, delivery);
    try {
      return await delivery;
    } finally {
      inFlight.delete(digest);
    }
  };
}

export function createBroadcastApp(
  config: BroadcastConfig,
  dependencies: BroadcastAppDependencies,
): Hono {
  const app = new Hono();
  const deliver = createDeliveryProcessor(config, dependencies);

  app.get("/livez", (context) => context.text("ok\n"));
  app.get("/readyz", (context) => context.json({ status: "ready" }));

  app.on(["POST", "PUT"], "/v1/traces", async (context) => {
    const stopTimer = dependencies.metrics.requestDurationSeconds.startTimer();
    if (
      !bearerMatches(
        bearerToken(context.req.header("authorization")),
        config.bearerToken,
      )
    ) {
      stopTimer();
      dependencies.metrics.requestsTotal.inc({ outcome: "unauthorized" });
      dependencies.logger.warn("Rejected unauthorized Broadcast delivery");
      return context.text("unauthorized\n", 401);
    }

    if (
      context.req
        .header("content-type")
        ?.toLowerCase()
        .startsWith("application/json") !== true
    ) {
      stopTimer();
      dependencies.metrics.requestsTotal.inc({
        outcome: "unsupported_media_type",
      });
      return context.text("application/json required\n", 415);
    }

    let bytes: number;
    let payload: OtlpJsonPayload;
    try {
      const body = await readBoundedBody(context.req.raw, config.maxBodyBytes);
      bytes = body.bytes;
      payload = OtlpJsonPayloadSchema.parse(parseJson(body.text));
    } catch (error) {
      stopTimer();
      if (error instanceof PayloadTooLargeError) {
        dependencies.metrics.requestsTotal.inc({ outcome: "too_large" });
        return context.text("payload too large\n", 413);
      }
      dependencies.metrics.requestsTotal.inc({ outcome: "invalid" });
      dependencies.logger.warn("Rejected invalid Broadcast delivery", {
        error:
          error instanceof ZodError
            ? error.issues.slice(0, 8)
            : error instanceof Error
              ? error.message
              : String(error),
      });
      return context.text("invalid OTLP JSON payload\n", 400);
    }

    dependencies.metrics.payloadBytes.observe(bytes);
    const summary = summarizeOtlpPayload(payload);
    try {
      const result = await deliver(payload);
      stopTimer();
      dependencies.metrics.requestsTotal.inc({
        outcome: result.duplicate ? "duplicate" : "success",
      });
      dependencies.metrics.lastSuccessTimestampSeconds.set(Date.now() / 1000);
      dependencies.logger.info("Accepted Broadcast delivery", {
        archiveKey: result.payloadKey,
        bytes,
        digest: result.digest,
        duplicate: result.duplicate,
        spanCount: summary.spanCount,
        traceId: summary.traceId,
      });
      return context.body(null, 204);
    } catch (error) {
      stopTimer();
      const phase =
        error instanceof BroadcastProcessingError ? error.phase : "archive";
      dependencies.metrics.requestsTotal.inc({ outcome: `${phase}_error` });
      dependencies.logger.error("Broadcast delivery failed", {
        bytes,
        error: error instanceof Error ? error.message : String(error),
        phase,
        spanCount: summary.spanCount,
        traceId: summary.traceId,
      });
      return context.text("delivery failed\n", 502);
    }
  });

  return app;
}
