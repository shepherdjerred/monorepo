import { z } from "zod";
import type {
  OtlpSpan,
  OtlpSpanStatus,
  OtlpTrace,
  TraceSummary,
} from "@shepherdjerred/ops-clients/tempo.ts";

type RawOtlpAnyValue = {
  stringValue?: string | undefined;
  intValue?: string | number | undefined;
  doubleValue?: number | string | undefined;
  boolValue?: boolean | undefined;
  bytesValue?: string | undefined;
  arrayValue?: { values?: RawOtlpAnyValue[] | undefined } | undefined;
  kvlistValue?: { values?: RawOtlpKeyValue[] | undefined } | undefined;
};

type RawOtlpKeyValue = {
  key: string;
  value?: RawOtlpAnyValue | undefined;
};

const OtlpKeyValueSchema: z.ZodType<RawOtlpKeyValue> = z.lazy(() =>
  z.object({
    key: z.string(),
    value: OtlpAnyValueSchema.optional(),
  }),
);

const OtlpAnyValueSchema: z.ZodType<RawOtlpAnyValue> = z.lazy(() =>
  z.object({
    stringValue: z.string().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.union([z.number(), z.string()]).optional(),
    boolValue: z.boolean().optional(),
    bytesValue: z.string().optional(),
    arrayValue: z
      .object({ values: z.array(OtlpAnyValueSchema).optional() })
      .optional(),
    kvlistValue: z
      .object({ values: z.array(OtlpKeyValueSchema).optional() })
      .optional(),
  }),
);

const SearchSpanSchema = z.object({
  spanID: z.string().optional(),
  name: z.string().optional(),
  startTimeUnixNano: z.string().optional(),
  durationNanos: z.string().optional(),
  attributes: z.array(OtlpKeyValueSchema).optional(),
});

const SearchSpanSetSchema = z.object({
  spans: z.array(SearchSpanSchema).optional(),
  attributes: z.array(OtlpKeyValueSchema).optional(),
  matched: z.number().int().nonnegative().optional(),
});

const ServiceStatSchema = z.object({
  spanCount: z.number().int().nonnegative().optional(),
  errorCount: z.number().int().nonnegative().optional(),
});

const TraceSummaryItemSchema = z.object({
  traceID: z.string().min(1),
  rootServiceName: z.string().optional(),
  rootTraceName: z.string().optional(),
  startTimeUnixNano: z.string().regex(/^\d{7,}$/u),
  durationMs: z.number().nonnegative().optional(),
  spanSet: SearchSpanSetSchema.optional(),
  spanSets: z.array(SearchSpanSetSchema).optional(),
  serviceStats: z.record(z.string(), ServiceStatSchema).optional(),
});

export const TempoSearchResponseSchema = z.object({
  traces: z.array(TraceSummaryItemSchema).default([]),
});

const RawOtlpEventSchema = z.object({
  name: z.string().default(""),
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  attributes: z.array(OtlpKeyValueSchema).optional(),
});

const RawOtlpSpanSchema = z.object({
  traceId: z.string().optional(),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().default(""),
  kind: z.union([z.number(), z.string()]).optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]),
  endTimeUnixNano: z.union([z.string(), z.number()]),
  attributes: z.array(OtlpKeyValueSchema).optional(),
  events: z.array(RawOtlpEventSchema).optional(),
  status: z
    .object({
      code: z.union([z.number(), z.string()]).optional(),
      message: z.string().optional(),
    })
    .optional(),
});

const RawScopeSpansSchema = z.object({
  scope: z.object({ name: z.string().optional() }).optional(),
  instrumentationLibrary: z.object({ name: z.string().optional() }).optional(),
  spans: z.array(RawOtlpSpanSchema).optional(),
});

const RawResourceSpansSchema = z.object({
  resource: z
    .object({ attributes: z.array(OtlpKeyValueSchema).optional() })
    .optional(),
  scopeSpans: z.array(RawScopeSpansSchema).optional(),
  instrumentationLibrarySpans: z.array(RawScopeSpansSchema).optional(),
});

export const RawTraceResponseSchema = z.union([
  z.object({ batches: z.array(RawResourceSpansSchema) }),
  z.object({ resourceSpans: z.array(RawResourceSpansSchema) }),
]);

function decodeOtlpAnyValue(value: RawOtlpAnyValue | undefined): unknown {
  if (value === undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map((entry) =>
      decodeOtlpAnyValue(entry),
    );
  }
  return value.kvlistValue === undefined
    ? null
    : decodeOtlpAttributes(value.kvlistValue.values);
}

function decodeOtlpAttributes(
  items: readonly RawOtlpKeyValue[] | undefined,
): Record<string, unknown> {
  if (items === undefined) return {};
  const attributes: Record<string, unknown> = {};
  for (const item of items) {
    attributes[item.key] = decodeOtlpAnyValue(item.value);
  }
  return attributes;
}

const HEX_ID_PATTERN = /^[\da-f]+$/iu;
const BASE64_SPAN_ID_PATTERN = /^[\w+/-]{11}=?$/u;
const BASE64_TRACE_ID_PATTERN = /^[\w+/-]{22}(?:==)?$/u;

function decodeBase64ToHex(
  encoded: string,
  expectedBytes: number,
): string | null {
  try {
    const bytes = Buffer.from(
      encoded.replaceAll("-", "+").replaceAll("_", "/"),
      "base64",
    );
    return bytes.length === expectedBytes
      ? bytes.toString("hex").toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function normalizeOtlpId(raw: string, expectedBytes: 8 | 16): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed.length === expectedBytes * 2 && HEX_ID_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const base64Pattern =
    expectedBytes === 8 ? BASE64_SPAN_ID_PATTERN : BASE64_TRACE_ID_PATTERN;
  if (base64Pattern.test(trimmed)) {
    const decoded = decodeBase64ToHex(trimmed, expectedBytes);
    if (decoded !== null) return decoded;
  }
  return HEX_ID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function normalizeParentSpanId(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const normalized = normalizeOtlpId(raw, 8);
  return normalized === "" || /^0+$/u.test(normalized) ? null : normalized;
}

function normalizeStatusCode(
  code: number | string | undefined,
): OtlpSpanStatus {
  if (
    code === 1 ||
    code === "STATUS_CODE_OK" ||
    code === "OK" ||
    code === "ok"
  ) {
    return "ok";
  }
  return code === 2 ||
    code === "STATUS_CODE_ERROR" ||
    code === "ERROR" ||
    code === "error"
    ? "error"
    : "unset";
}

function readStringAttr(
  attrs: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = attrs[key];
  return typeof val === "string" && val.trim() !== "" ? val : undefined;
}

function readNumberAttr(
  attrs: Record<string, unknown>,
  key: string,
): number | undefined {
  const val = attrs[key];
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

function isToolAttrKey(key: string): boolean {
  return (
    key.startsWith("gen_ai.tool.") ||
    key.startsWith("ai.toolCall.") ||
    key === "ai.response.toolCalls" ||
    key.endsWith(".tool.command") ||
    key.endsWith(".stdout_snippet")
  );
}

function hasToolMarkerInBody(raw: unknown): boolean {
  return (
    typeof raw === "string" &&
    (raw.includes('"tool_call"') ||
      raw.includes('"tool-call"') ||
      raw.includes('"tool_use"') ||
      raw.includes('"tool_result"'))
  );
}

function detectToolIo(
  spanName: string | undefined,
  attrs: Record<string, unknown>,
): boolean {
  return (
    spanName?.endsWith(".tool") === true ||
    attrs["gen_ai.operation.name"] === "execute_tool" ||
    Object.keys(attrs).some((key) => isToolAttrKey(key)) ||
    hasToolMarkerInBody(attrs["gen_ai.output.messages"]) ||
    hasToolMarkerInBody(attrs["gen_ai.input.messages"])
  );
}

type EnrichmentAccumulator = {
  environment: string | null;
  workloads: Set<string>;
  providers: Set<string>;
  models: Set<string>;
  subject: { kind: string; id: string } | null;
  sawInputTokens: boolean;
  inputTokens: number;
  sawOutputTokens: boolean;
  outputTokens: number;
  sawCachedTokens: boolean;
  cachedInputTokens: number;
  hasToolIo: boolean;
};

function addTokenEnrichment(
  attrs: Record<string, unknown>,
  acc: EnrichmentAccumulator,
): void {
  const inTok =
    readNumberAttr(attrs, "gen_ai.usage.input_tokens") ??
    readNumberAttr(attrs, "ai.usage.inputTokens") ??
    readNumberAttr(attrs, "ai.usage.promptTokens");
  if (inTok !== undefined) {
    acc.sawInputTokens = true;
    acc.inputTokens += inTok;
  }
  const outTok =
    readNumberAttr(attrs, "gen_ai.usage.output_tokens") ??
    readNumberAttr(attrs, "ai.usage.outputTokens") ??
    readNumberAttr(attrs, "ai.usage.completionTokens");
  if (outTok !== undefined) {
    acc.sawOutputTokens = true;
    acc.outputTokens += outTok;
  }
  const cachedTok =
    readNumberAttr(attrs, "gen_ai.usage.cache_read_input_tokens") ??
    readNumberAttr(attrs, "gen_ai.usage.cache_read.input_tokens");
  if (cachedTok !== undefined) {
    acc.sawCachedTokens = true;
    acc.cachedInputTokens += cachedTok;
  }
}

function collectAttributesEnrichment(
  attrs: Record<string, unknown>,
  spanName: string | undefined,
  acc: EnrichmentAccumulator,
): void {
  acc.environment ??=
    readStringAttr(attrs, "deployment.environment.name") ??
    readStringAttr(attrs, "deployment.environment") ??
    readStringAttr(attrs, "environment") ??
    null;

  const workload = readStringAttr(attrs, "llm.call_site");
  if (workload !== undefined) acc.workloads.add(workload);
  const provider =
    readStringAttr(attrs, "gen_ai.system") ??
    readStringAttr(attrs, "gen_ai.provider.name");
  if (provider !== undefined) acc.providers.add(provider);
  const model =
    readStringAttr(attrs, "gen_ai.request.model") ??
    readStringAttr(attrs, "gen_ai.response.model");
  if (model !== undefined) acc.models.add(model);
  if (acc.subject === null) {
    const kind = readStringAttr(attrs, "llm.subject.kind");
    const id = readStringAttr(attrs, "llm.subject.id");
    if (kind !== undefined && id !== undefined) acc.subject = { kind, id };
  }
  addTokenEnrichment(attrs, acc);
  if (!acc.hasToolIo && detectToolIo(spanName, attrs)) acc.hasToolIo = true;
}

export function mapSearchTrace(
  trace: z.infer<typeof TraceSummaryItemSchema>,
): TraceSummary {
  const base: TraceSummary = {
    traceId: trace.traceID,
    rootServiceName: trace.rootServiceName,
    rootTraceName: trace.rootTraceName,
    startedAt: new Date(Number(trace.startTimeUnixNano.slice(0, -6))),
    durationMs: trace.durationMs ?? 0,
  };
  const spanSets = [
    ...(trace.spanSets ?? []),
    ...(trace.spanSet === undefined ? [] : [trace.spanSet]),
  ];
  if (spanSets.length === 0 && trace.serviceStats === undefined) {
    return base;
  }

  const acc: EnrichmentAccumulator = {
    environment: null,
    workloads: new Set<string>(),
    providers: new Set<string>(),
    models: new Set<string>(),
    subject: null,
    sawInputTokens: false,
    inputTokens: 0,
    sawOutputTokens: false,
    outputTokens: 0,
    sawCachedTokens: false,
    cachedInputTokens: 0,
    hasToolIo: false,
  };

  let spanSetSpanCount = 0;
  for (const set of spanSets) {
    collectAttributesEnrichment(
      decodeOtlpAttributes(set.attributes),
      undefined,
      acc,
    );
    const spans = set.spans ?? [];
    spanSetSpanCount += Math.max(set.matched ?? 0, spans.length);
    for (const span of spans) {
      collectAttributesEnrichment(
        decodeOtlpAttributes(span.attributes),
        span.name,
        acc,
      );
    }
  }

  let spanCount = spanSetSpanCount;
  let errorCount = 0;
  if (trace.serviceStats !== undefined) {
    let statsSpans = 0;
    for (const stat of Object.values(trace.serviceStats)) {
      statsSpans += stat.spanCount ?? 0;
      errorCount += stat.errorCount ?? 0;
    }
    spanCount = Math.max(statsSpans, spanSetSpanCount);
  }

  return {
    ...base,
    spanCount,
    errorCount,
    environment: acc.environment,
    workloads: [...acc.workloads],
    providers: [...acc.providers],
    models: [...acc.models],
    subject: acc.subject,
    inputTokens: acc.sawInputTokens ? acc.inputTokens : null,
    outputTokens: acc.sawOutputTokens ? acc.outputTokens : null,
    cachedInputTokens: acc.sawCachedTokens ? acc.cachedInputTokens : null,
    hasToolIo: acc.hasToolIo,
  };
}

function mapRawOtlpSpan(
  rawSpan: z.infer<typeof RawOtlpSpanSchema>,
  ctx: {
    normalizedTraceId: string;
    serviceName: string;
    scopeName: string | null;
    resourceAttributes: Record<string, unknown>;
  },
): OtlpSpan {
  const spanTraceId =
    rawSpan.traceId === undefined
      ? ctx.normalizedTraceId
      : normalizeOtlpId(rawSpan.traceId, 16);
  const msg = rawSpan.status?.message;
  const statusMessage = msg === undefined || msg === "" ? null : msg;

  return {
    traceId: spanTraceId === "" ? ctx.normalizedTraceId : spanTraceId,
    spanId: normalizeOtlpId(rawSpan.spanId, 8),
    parentSpanId: normalizeParentSpanId(rawSpan.parentSpanId),
    name: rawSpan.name === "" ? "unnamed" : rawSpan.name,
    kind: rawSpan.kind,
    startTimeUnixNano: String(rawSpan.startTimeUnixNano),
    endTimeUnixNano: String(rawSpan.endTimeUnixNano),
    status: normalizeStatusCode(rawSpan.status?.code),
    statusMessage,
    serviceName: ctx.serviceName,
    scopeName: ctx.scopeName,
    attributes: decodeOtlpAttributes(rawSpan.attributes),
    resourceAttributes: ctx.resourceAttributes,
    events: (rawSpan.events ?? []).map((event) => ({
      name: event.name,
      timeUnixNano:
        event.timeUnixNano === undefined
          ? String(rawSpan.startTimeUnixNano)
          : String(event.timeUnixNano),
      attributes: decodeOtlpAttributes(event.attributes),
    })),
  };
}

export function normalizeRawTrace(
  requestedTraceId: string,
  parsed: z.infer<typeof RawTraceResponseSchema>,
): OtlpTrace {
  const resourceSpansList =
    "batches" in parsed ? parsed.batches : parsed.resourceSpans;
  const normalizedTraceId = normalizeOtlpId(requestedTraceId, 16);
  const spans: OtlpSpan[] = [];

  for (const resourceSpan of resourceSpansList) {
    const resourceAttributes = decodeOtlpAttributes(
      resourceSpan.resource?.attributes,
    );
    const serviceName =
      readStringAttr(resourceAttributes, "service.name") ?? "unknown";
    const scopeGroups =
      resourceSpan.scopeSpans ?? resourceSpan.instrumentationLibrarySpans ?? [];
    for (const scopeGroup of scopeGroups) {
      const scopeName =
        scopeGroup.scope?.name ??
        scopeGroup.instrumentationLibrary?.name ??
        null;
      for (const rawSpan of scopeGroup.spans ?? []) {
        spans.push(
          mapRawOtlpSpan(rawSpan, {
            normalizedTraceId,
            serviceName,
            scopeName,
            resourceAttributes,
          }),
        );
      }
    }
  }

  return {
    traceId: spans[0]?.traceId ?? normalizedTraceId,
    spans,
  };
}
