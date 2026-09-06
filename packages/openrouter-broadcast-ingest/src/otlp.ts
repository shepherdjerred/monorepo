import { redactSecrets } from "@shepherdjerred/llm-observability";
import { z } from "zod";

const MAX_RESOURCE_SPANS = 256;
const MAX_SCOPE_SPANS = 2048;
const MAX_SPANS = 20_000;
const MAX_ATTRIBUTES = 2048;

const KeyValueSchema = z
  .object({
    key: z.string().min(1).max(1024),
    value: z.unknown(),
  })
  .loose();

const SpanEventSchema = z
  .object({
    attributes: z.array(KeyValueSchema).max(MAX_ATTRIBUTES).optional(),
  })
  .loose();

const SpanLinkSchema = z
  .object({
    attributes: z.array(KeyValueSchema).max(MAX_ATTRIBUTES).optional(),
  })
  .loose();

const SpanSchema = z
  .object({
    traceId: z.string().min(1).max(128),
    spanId: z.string().min(1).max(64),
    parentSpanId: z.string().max(64).optional(),
    attributes: z.array(KeyValueSchema).max(MAX_ATTRIBUTES).optional(),
    events: z.array(SpanEventSchema).max(2048).optional(),
    links: z.array(SpanLinkSchema).max(2048).optional(),
  })
  .loose();

const ScopeSpansSchema = z
  .object({
    spans: z.array(SpanSchema).max(MAX_SPANS),
  })
  .loose();

const ResourceSpansSchema = z
  .object({
    resource: z
      .object({
        attributes: z.array(KeyValueSchema).max(MAX_ATTRIBUTES).optional(),
      })
      .loose()
      .optional(),
    scopeSpans: z.array(ScopeSpansSchema).max(MAX_SCOPE_SPANS),
  })
  .loose();

export const OtlpJsonPayloadSchema = z
  .object({
    resourceSpans: z.array(ResourceSpansSchema).max(MAX_RESOURCE_SPANS),
  })
  .loose();

export type OtlpJsonPayload = z.infer<typeof OtlpJsonPayloadSchema>;

const SECRET_ATTRIBUTE_KEY =
  /(?:^|[._-])(?:authorization|api[_-]?key|access[_-]?key|secret(?:[_-]?(?:key|token))?|password|token|credential)(?:$|[._-])/i;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

/**
 * Serialize a payload with object keys in a stable order, for hashing only.
 *
 * `JSON.stringify` preserves insertion order, and the payload schema is
 * `.loose()`, so unrecognized keys keep whatever order the sender emitted them
 * in. Digesting that directly would give two semantically identical deliveries
 * different digests and defeat deduplication. Array order is meaningful in OTLP
 * and is preserved. The archived object keeps the verbatim serialization — this
 * is the dedupe key, not the stored artifact.
 */
export function canonicalOtlpJson(payload: OtlpJsonPayload): string {
  return JSON.stringify(canonicalize(payload));
}

function redactOtlpKeyValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactOtlpKeyValues(entry));
  }
  if (value === null || typeof value !== "object") return value;

  const record = z.record(z.string(), z.unknown()).parse(value);
  const entries = Object.entries(record);
  const attributeKey = record["key"];
  const redactValue =
    typeof attributeKey === "string" && SECRET_ATTRIBUTE_KEY.test(attributeKey);
  const result: Record<string, unknown> = {};
  for (const [key, inner] of entries) {
    result[key] =
      redactValue && key === "value"
        ? { stringValue: "[REDACTED]" }
        : redactOtlpKeyValues(inner);
  }
  return result;
}

/** Redact both ordinary JSON secret fields and OTLP key/value attributes. */
export function redactOtlpPayload(
  payload: OtlpJsonPayload,
  bearerToken: string,
): unknown {
  return redactSecrets(redactOtlpKeyValues(payload), [bearerToken]);
}

export function summarizeOtlpPayload(payload: OtlpJsonPayload): {
  spanCount: number;
  traceId: string | undefined;
} {
  let spanCount = 0;
  let traceId: string | undefined;
  for (const resourceSpans of payload.resourceSpans) {
    for (const scopeSpans of resourceSpans.scopeSpans) {
      spanCount += scopeSpans.spans.length;
      traceId ??= scopeSpans.spans[0]?.traceId;
    }
  }
  return { spanCount, traceId };
}
