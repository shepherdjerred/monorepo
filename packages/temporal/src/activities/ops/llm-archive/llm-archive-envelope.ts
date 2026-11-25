import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  ArchivedSpanIndexRowSchema,
  type ArchivedSpanIndexRow,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import type { StructuredLogger } from "#observability/logging.ts";

const EnvelopePartSchema = z.looseObject({
  type: z.string().optional(),
});

const EnvelopeMessageSchema = z.looseObject({
  role: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  toolCalls: z.array(z.unknown()).optional(),
  parts: z.array(z.unknown()).optional(),
  content: z.unknown().optional(),
});

const EnvelopeRequestSchema = z.looseObject({
  model: z.unknown().optional(),
});

const EnvelopeResponseSchema = z.looseObject({
  model: z.unknown().optional(),
  id: z.unknown().optional(),
  finishReasons: z.unknown().optional(),
  finishReason: z.unknown().optional(),
});

const EnvelopeUsageSchema = z.looseObject({
  inputTokens: z.unknown().optional(),
  outputTokens: z.unknown().optional(),
  cacheReadInputTokens: z.unknown().optional(),
  cacheReadTokens: z.unknown().optional(),
  cacheCreationInputTokens: z.unknown().optional(),
  cacheCreationTokens: z.unknown().optional(),
});

const LooseObjectSchema = z.record(z.string(), z.unknown());

const V1EnvelopeSchema = z.looseObject({
  v: z.literal(1),
  traceId: z.unknown().optional(),
  spanId: z.unknown().optional(),
  capturedAt: z.unknown().optional(),
  service: z.unknown().optional(),
  provider: z.unknown().optional(),
  callSite: z.unknown().optional(),
  request: z.unknown().optional(),
  response: z.unknown().optional(),
  usage: z.unknown().optional(),
});

const TOOL_PART_TYPES = new Set([
  "tool_call",
  "tool-call",
  "tool_call_response",
  "tool-result",
  "tool_use",
  "tool_result",
]);

const TOOL_FINISH_REASONS = new Set(["tool_calls", "tool-calls", "tool_use"]);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function arrayContainsToolPart(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((rawPart) => {
    const parsed = EnvelopePartSchema.safeParse(rawPart);
    return (
      parsed.success &&
      parsed.data.type !== undefined &&
      TOOL_PART_TYPES.has(parsed.data.type)
    );
  });
}

function singleMessageHasToolIo(rawMsg: unknown): boolean {
  const parsed = EnvelopeMessageSchema.safeParse(rawMsg);
  if (!parsed.success) return false;
  const msg = parsed.data;
  const hasToolCalls =
    (msg.tool_calls?.length ?? 0) > 0 || (msg.toolCalls?.length ?? 0) > 0;
  return (
    msg.role === "tool" ||
    hasToolCalls ||
    arrayContainsToolPart(msg.parts) ||
    arrayContainsToolPart(msg.content)
  );
}

function messageArrayHasToolIo(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.some((rawMsg) => singleMessageHasToolIo(rawMsg))
  );
}

function hasDeclaredTools(tools: unknown): boolean {
  if (Array.isArray(tools)) return tools.length > 0;
  if (typeof tools === "string") {
    const trimmed = tools.trim();
    return trimmed !== "" && trimmed !== "[]";
  }
  return false;
}

function detectEnvelopeToolIo(
  envelope: Readonly<Record<string, unknown>>,
  finishReason: string | null,
): boolean {
  const hasDirectToolAttrs =
    envelope["gen_ai.tool.stdout"] !== undefined ||
    envelope["gen_ai.tool.stderr"] !== undefined ||
    hasDeclaredTools(envelope["gen_ai.input.tools"]) ||
    (finishReason !== null && TOOL_FINISH_REASONS.has(finishReason));
  return (
    hasDirectToolAttrs ||
    messageArrayHasToolIo(envelope["gen_ai.input.messages"]) ||
    messageArrayHasToolIo(envelope["gen_ai.output.messages"]) ||
    messageArrayHasToolIo(envelope["ai.prompt.messages"])
  );
}

function gunzipJson(
  s3Key: string,
  compressedBytes: Uint8Array,
  logger: StructuredLogger,
): { parsed: unknown; bytesUncompressed: number } | null {
  let uncompressedText: string;
  let bytesUncompressed: number;
  try {
    const decompressed = gunzipSync(compressedBytes);
    bytesUncompressed = decompressed.byteLength;
    uncompressedText = decompressed.toString("utf8");
  } catch (error: unknown) {
    logger("warning", "Skipping unreadable gzipped llm-archive object", {
      s3Key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  try {
    return { parsed: JSON.parse(uncompressedText), bytesUncompressed };
  } catch (error: unknown) {
    logger("warning", "Skipping invalid JSON llm-archive object", {
      s3Key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function extractFinishReason(
  response: z.infer<typeof EnvelopeResponseSchema> | undefined,
): string | null {
  if (response === undefined) return null;
  const firstFromArray = Array.isArray(response.finishReasons)
    ? nonEmptyString(response.finishReasons[0])
    : null;
  return firstFromArray ?? nonEmptyString(response.finishReason);
}

function extractOptionalSubObjects(
  envelope: z.infer<typeof V1EnvelopeSchema>,
): {
  request: z.infer<typeof EnvelopeRequestSchema> | undefined;
  response: z.infer<typeof EnvelopeResponseSchema> | undefined;
  usage: z.infer<typeof EnvelopeUsageSchema> | undefined;
} {
  const reqParsed = EnvelopeRequestSchema.safeParse(envelope.request);
  const resParsed = EnvelopeResponseSchema.safeParse(envelope.response);
  const useParsed = EnvelopeUsageSchema.safeParse(envelope.usage);
  return {
    request: reqParsed.success ? reqParsed.data : undefined,
    response: resParsed.success ? resParsed.data : undefined,
    usage: useParsed.success ? useParsed.data : undefined,
  };
}

function buildRawIndexRow(input: {
  s3Key: string;
  traceId: string;
  spanId: string;
  capturedAtMs: number;
  fallbackService: string;
  fallbackProvider: string;
  envelope: z.infer<typeof V1EnvelopeSchema>;
  bytesCompressed: number;
  bytesUncompressed: number;
}) {
  const { request, response, usage } = extractOptionalSubObjects(
    input.envelope,
  );
  const finishReason = extractFinishReason(response);
  return {
    s3Key: input.s3Key,
    traceId: input.traceId,
    spanId: input.spanId,
    capturedAtMs: Math.floor(input.capturedAtMs),
    service: nonEmptyString(input.envelope.service) ?? input.fallbackService,
    provider: nonEmptyString(input.envelope.provider) ?? input.fallbackProvider,
    callSite: nonEmptyString(input.envelope.callSite) ?? "unknown",
    requestModel: nonEmptyString(request?.model),
    responseModel: nonEmptyString(response?.model),
    responseId: nonEmptyString(response?.id),
    finishReason,
    inputTokens: nonNegativeInt(usage?.inputTokens),
    outputTokens: nonNegativeInt(usage?.outputTokens),
    cacheReadTokens: nonNegativeInt(
      usage?.cacheReadInputTokens ?? usage?.cacheReadTokens,
    ),
    cacheCreationTokens: nonNegativeInt(
      usage?.cacheCreationInputTokens ?? usage?.cacheCreationTokens,
    ),
    hasToolIo: detectEnvelopeToolIo(input.envelope, finishReason),
    bytesCompressed: input.bytesCompressed,
    bytesUncompressed: input.bytesUncompressed,
  };
}

export function parseArchiveEnvelopeToIndexRow(input: {
  s3Key: string;
  compressedBytes: Uint8Array;
  fallbackService: string;
  fallbackProvider: string;
  logger: StructuredLogger;
}): ArchivedSpanIndexRow | null {
  const bytesCompressed = input.compressedBytes.byteLength;
  const decoded = gunzipJson(input.s3Key, input.compressedBytes, input.logger);
  if (decoded === null) return null;

  const v1 = V1EnvelopeSchema.safeParse(decoded.parsed);
  if (!v1.success) {
    const recordCheck = LooseObjectSchema.safeParse(decoded.parsed);
    input.logger("warning", "Skipping non-v1 llm-archive envelope", {
      s3Key: input.s3Key,
      envelopeVersion: recordCheck.success
        ? (recordCheck.data["v"] ?? null)
        : null,
    });
    return null;
  }

  const envelope = v1.data;
  const traceId = nonEmptyString(envelope.traceId);
  const spanId = nonEmptyString(envelope.spanId);
  const capturedAtRaw = nonEmptyString(envelope.capturedAt);
  const capturedAtMs =
    capturedAtRaw === null ? Number.NaN : Date.parse(capturedAtRaw);

  if (
    traceId === null ||
    spanId === null ||
    !Number.isFinite(capturedAtMs) ||
    capturedAtMs < 0
  ) {
    input.logger("warning", "Skipping malformed v1 llm-archive envelope", {
      s3Key: input.s3Key,
      hasTraceId: traceId !== null,
      hasSpanId: spanId !== null,
      capturedAt: capturedAtRaw,
    });
    return null;
  }

  const rowResult = ArchivedSpanIndexRowSchema.safeParse(
    buildRawIndexRow({
      s3Key: input.s3Key,
      traceId,
      spanId,
      capturedAtMs,
      fallbackService: input.fallbackService,
      fallbackProvider: input.fallbackProvider,
      envelope,
      bytesCompressed,
      bytesUncompressed: decoded.bytesUncompressed,
    }),
  );

  if (!rowResult.success) {
    input.logger("warning", "Skipping llm-archive row failing schema check", {
      s3Key: input.s3Key,
      error: rowResult.error.message,
    });
    return null;
  }

  return rowResult.data;
}
