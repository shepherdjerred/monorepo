import { type Context, type AttributeValue } from "@opentelemetry/api";
import {
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  type ArchiveConfig,
  type ArchiveRef,
  buildArchiveKey,
  uploadArchive,
} from "./archive-uploader.ts";
import { redactSecrets } from "./redact.ts";

/**
 * Span attribute keys that hold large LLM bodies. The processor extracts these
 * into the archive envelope and strips them from the forwarded span so Tempo
 * receives only a slim ref. Adding a new key here is enough to support a new
 * SDK convention without touching wrappers.
 */
const BODY_ATTR_KEYS = [
  // OTel GenAI semconv
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.input.tools",
  // Vercel AI SDK legacy attribute names
  "ai.prompt.messages",
  "ai.prompt",
  "ai.response.text",
  "ai.response.object",
] as const;

const BODY_ATTR_SET: ReadonlySet<string> = new Set(BODY_ATTR_KEYS);

export type ArchiveLogger = {
  warn(message: string, fields?: Record<string, unknown>): void;
  info?(message: string, fields?: Record<string, unknown>): void;
};

const noopLogger: ArchiveLogger = {
  warn(message, fields) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: message,
        component: "llm-observability",
        ...fields,
      }),
    );
  },
};

export type ArchiveUploader = (
  config: ArchiveConfig,
  key: string,
  jsonPayload: string,
) => Promise<ArchiveRef>;

export type LlmArchiveSpanProcessorOptions = {
  /** Underlying processor — typically a BatchSpanProcessor wrapping an OTLP exporter. */
  inner: SpanProcessor;
  /** S3 archive configuration (bucket, endpoint, creds, etc.). */
  archive: ArchiveConfig;
  /** Logger for upload failures. Defaults to JSON-stderr. */
  logger?: ArchiveLogger | undefined;
  /** 0..1. Spans rolling above the rate are not archived (bodies still stripped). */
  sampleRate?: number | undefined;
  /** Provide deterministic random for tests. */
  random?: (() => number) | undefined;
  /** Override the real S3 uploader — for tests. */
  uploader?: ArchiveUploader | undefined;
};

/**
 * SpanProcessor that wraps another processor. On span end, if the span carries
 * known LLM body attributes:
 *
 *  1. Build a single JSON envelope from the body attributes (request +
 *     response + usage where present).
 *  2. Redact obvious secrets.
 *  3. Gzip and PUT to S3 with a deterministic key.
 *  4. Forward a *copy* of the span to `inner` with the bodies stripped and
 *     `llm.archive.*` attributes added (bucket, key, sha256, sizes, status).
 *
 * Spans without LLM body attributes pass through unchanged. The S3 upload runs
 * asynchronously; the wrapped span is forwarded to `inner.onEnd` only after
 * the upload settles. Upload failures degrade gracefully — the span is still
 * forwarded with `llm.archive.status = "failed"`.
 */
export class LlmArchiveSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor;
  private readonly archive: ArchiveConfig;
  private readonly logger: ArchiveLogger;
  private readonly sampleRate: number;
  private readonly random: () => number;
  private readonly uploader: ArchiveUploader;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(options: LlmArchiveSpanProcessorOptions) {
    this.inner = options.inner;
    this.archive = options.archive;
    this.logger = options.logger ?? noopLogger;
    this.sampleRate = options.sampleRate ?? 1;
    this.random = options.random ?? Math.random;
    this.uploader = options.uploader ?? uploadArchive;
  }

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (!hasLlmBodyAttributes(span)) {
      this.inner.onEnd(span);
      return;
    }

    const sampled = this.random() < this.sampleRate;
    const promise = this.processLlmSpan(span, sampled).catch(
      (error: unknown) => {
        // Defensive: the processLlmSpan path catches its own upload errors;
        // this branch should only fire for bugs.
        this.logger.warn("llm-observability: span processing crashed", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.inner.onEnd(span);
      },
    );
    this.inFlight.add(promise);
    promise.finally(() => this.inFlight.delete(promise));
  }

  async shutdown(): Promise<void> {
    await this.flushInFlight();
    await this.inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.flushInFlight();
    await this.inner.forceFlush();
  }

  private async flushInFlight(): Promise<void> {
    if (this.inFlight.size === 0) return;
    await Promise.allSettled([...this.inFlight]);
  }

  private async processLlmSpan(
    span: ReadableSpan,
    sampled: boolean,
  ): Promise<void> {
    const envelope = buildEnvelope(span);

    if (!sampled) {
      const stripped = stripBodyAttributes(span.attributes);
      const slim = copySpanWithAttributes(span, {
        ...stripped,
        "llm.archive.status": "sampled_out",
      });
      this.inner.onEnd(slim);
      return;
    }

    const provider = stringAttr(span.attributes["gen_ai.system"]) ?? "unknown";
    const serviceName =
      stringAttr(span.resource.attributes["service.name"]) ?? "unknown";

    const key = buildArchiveKey(this.archive, {
      service: serviceName,
      provider,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
    });

    const redacted = redactSecrets(envelope);
    const payload = JSON.stringify(redacted);
    const ref = await this.uploader(this.archive, key, payload);

    if (ref.status === "failed") {
      this.logger.warn("llm-observability: S3 upload failed", {
        bucket: ref.bucket,
        key: ref.key,
        error: ref.error,
      });
    }

    const stripped = stripBodyAttributes(span.attributes);
    const slim = copySpanWithAttributes(span, {
      ...stripped,
      ...refToAttributes(ref),
    });
    this.inner.onEnd(slim);
  }
}

function hasLlmBodyAttributes(span: ReadableSpan): boolean {
  for (const key of BODY_ATTR_KEYS) {
    if (span.attributes[key] !== undefined) return true;
  }
  return false;
}

function stripBodyAttributes(
  attrs: Readonly<Record<string, AttributeValue | undefined>>,
): Record<string, AttributeValue> {
  const result: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (BODY_ATTR_SET.has(key)) continue;
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}

function refToAttributes(ref: ArchiveRef): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "llm.archive.s3_bucket": ref.bucket,
    "llm.archive.s3_key": ref.key,
    "llm.archive.sha256": ref.sha256,
    "llm.archive.bytes_compressed": ref.bytesCompressed,
    "llm.archive.bytes_uncompressed": ref.bytesUncompressed,
    "llm.archive.status": ref.status,
  };
  if (ref.error !== undefined) {
    attrs["llm.archive.error"] = ref.error;
  }
  return attrs;
}

function buildEnvelope(span: ReadableSpan): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    v: 1,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    capturedAt: new Date().toISOString(),
    service: stringAttr(span.resource.attributes["service.name"]) ?? "unknown",
    provider: stringAttr(span.attributes["gen_ai.system"]) ?? "unknown",
    callSite: stringAttr(span.attributes["llm.call_site"]) ?? "unknown",
    request: {
      model: stringAttr(span.attributes["gen_ai.request.model"]),
      maxTokens: numberAttr(span.attributes["gen_ai.request.max_tokens"]),
      temperature: numberAttr(span.attributes["gen_ai.request.temperature"]),
      topP: numberAttr(span.attributes["gen_ai.request.top_p"]),
    },
    response: {
      model: stringAttr(span.attributes["gen_ai.response.model"]),
      id: stringAttr(span.attributes["gen_ai.response.id"]),
      finishReasons: stringArrayAttr(
        span.attributes["gen_ai.response.finish_reasons"],
      ),
    },
    usage: {
      inputTokens: numberAttr(span.attributes["gen_ai.usage.input_tokens"]),
      outputTokens: numberAttr(span.attributes["gen_ai.usage.output_tokens"]),
      cacheReadInputTokens: numberAttr(
        span.attributes["gen_ai.usage.cache_read_input_tokens"],
      ),
      cacheCreationInputTokens: numberAttr(
        span.attributes["gen_ai.usage.cache_creation_input_tokens"],
      ),
    },
  };

  for (const key of BODY_ATTR_KEYS) {
    const value = span.attributes[key];
    if (value === undefined) continue;
    envelope[key] = typeof value === "string" ? safeJsonParse(value) : value;
  }
  return envelope;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringAttr(value: AttributeValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberAttr(value: AttributeValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringArrayAttr(
  value: AttributeValue | undefined,
): string[] | undefined {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value;
  }
  return undefined;
}

/**
 * Construct a ReadableSpan-shaped object that shadows the original's
 * attributes with a new map while delegating every other accessor to the
 * underlying span. We can't mutate the original after `span.end()` — OTel
 * treats ReadableSpan attributes as immutable post-end — so we hand the
 * downstream exporter a fresh object instead.
 */
function copySpanWithAttributes(
  span: ReadableSpan,
  attributes: Record<string, AttributeValue>,
): ReadableSpan {
  const common = {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
    attributes,
    links: span.links,
    events: span.events,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
  if (span.parentSpanContext === undefined) {
    return common;
  }
  return { ...common, parentSpanContext: span.parentSpanContext };
}
