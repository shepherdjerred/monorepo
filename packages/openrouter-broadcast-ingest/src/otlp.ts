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

const BODY_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "ai.prompt",
  "ai.prompt.messages",
  "ai.response.object",
  "ai.response.text",
  "gen_ai.input.messages",
  "gen_ai.input.tools",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.stderr",
  "gen_ai.tool.stdout",
  "http.request.body",
  "http.response.body",
]);

const SECRET_ATTRIBUTE_KEY =
  /(?:^|[._-])(?:authorization|api[_-]?key|access[_-]?key|secret(?:[_-]?(?:key|token))?|password|token|credential)(?:$|[._-])/i;

function isBodyAttribute(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SECRET_ATTRIBUTE_KEY.test(normalized)) return true;
  if (BODY_ATTRIBUTE_KEYS.has(normalized)) return true;
  if (normalized.includes("prompt") || normalized.includes("completion")) {
    return true;
  }
  if (
    normalized.endsWith(".content") ||
    normalized.endsWith(".body") ||
    normalized.includes("message.content")
  ) {
    return true;
  }
  return (
    normalized.includes("tool") &&
    /argument|input|output|result/i.test(normalized)
  );
}

function stripAttributes(
  attributes: z.infer<typeof KeyValueSchema>[] | undefined,
): z.infer<typeof KeyValueSchema>[] | undefined {
  return attributes?.filter((attribute) => !isBodyAttribute(attribute.key));
}

/** Strip prompt, response, and tool bodies while retaining routing, usage, and cost data. */
export function slimOtlpPayload(payload: OtlpJsonPayload): OtlpJsonPayload {
  return {
    ...payload,
    resourceSpans: payload.resourceSpans.map((resourceSpans) => ({
      ...resourceSpans,
      ...(resourceSpans.resource === undefined
        ? {}
        : {
            resource: {
              ...resourceSpans.resource,
              attributes: stripAttributes(resourceSpans.resource.attributes),
            },
          }),
      scopeSpans: resourceSpans.scopeSpans.map((scopeSpans) => ({
        ...scopeSpans,
        spans: scopeSpans.spans.map((span) => ({
          ...span,
          attributes: stripAttributes(span.attributes),
          events: span.events?.map((event) => ({
            ...event,
            attributes: stripAttributes(event.attributes),
          })),
          links: span.links?.map((link) => ({
            ...link,
            attributes: stripAttributes(link.attributes),
          })),
        })),
      })),
    })),
  };
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
