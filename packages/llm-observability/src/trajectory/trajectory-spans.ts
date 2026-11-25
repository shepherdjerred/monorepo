import type { ArchivedSpanIndexRow } from "@shepherdjerred/ops-model/llm-traces.ts";
import type { CodexCandidateSpan } from "./trajectory-codex.ts";
import { readSpanString } from "./trajectory-leaf.ts";
import type { OtlpSpanShape, OtlpTraceShape } from "#src/trajectory.ts";

export type InternalSpan = CodexCandidateSpan & {
  readonly scopeName: string | null;
  readonly resourceAttributes: Readonly<Record<string, unknown>>;
  readonly events: readonly {
    name: string;
    timestampMs: number;
    attributes: Record<string, unknown>;
  }[];
};

function unixNanoToMs(nanoStr: string): number {
  const trimmed = nanoStr.trim();
  if (!/^\d+$/u.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed / 1_000_000 : 0;
  }
  if (trimmed.length <= 6) {
    return Number(trimmed) / 1_000_000;
  }
  const wholeMs = Number(trimmed.slice(0, -6));
  const subMs = Number(trimmed.slice(-6)) / 1_000_000;
  return wholeMs + subMs;
}

export function otlpToInternalSpans(
  trace: OtlpTraceShape,
  hydratedEnvelopes: ReadonlyMap<string, Record<string, unknown>> | undefined,
): InternalSpan[] {
  return trace.spans.map((span: OtlpSpanShape): InternalSpan => {
    const startedAtMs = unixNanoToMs(span.startTimeUnixNano);
    const endedAtMs = Math.max(startedAtMs, unixNanoToMs(span.endTimeUnixNano));
    const resAttrs = span.resourceAttributes ?? {};
    const service =
      span.serviceName ??
      readSpanString(resAttrs, "service.name") ??
      readSpanString(span.attributes, "llm.service") ??
      "unknown";
    const archiveKey =
      readSpanString(span.attributes, "llm.archive.s3_key") ?? null;
    const envelope =
      (archiveKey === null ? undefined : hydratedEnvelopes?.get(archiveKey)) ??
      hydratedEnvelopes?.get(span.spanId);

    return {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name === "" ? "unnamed" : span.name,
      service,
      scopeName: span.scopeName ?? null,
      startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      status: span.status,
      statusMessage: span.statusMessage,
      attributes: span.attributes,
      resourceAttributes: resAttrs,
      envelope,
      archiveKey,
      events: (span.events ?? []).map((ev) => ({
        name: ev.name,
        timestampMs: unixNanoToMs(ev.timeUnixNano),
        attributes: { ...ev.attributes },
      })),
    };
  });
}

function inferArchivedSpanName(
  row: ArchivedSpanIndexRow,
  envelope: Readonly<Record<string, unknown>> | undefined,
): string {
  if (
    envelope !== undefined &&
    (envelope["ai.value"] !== undefined ||
      envelope["ai.values"] !== undefined ||
      envelope["ai.embedding"] !== undefined ||
      envelope["ai.embeddings"] !== undefined)
  ) {
    return "gen_ai.embeddings";
  }
  if (
    envelope !== undefined &&
    (envelope["gen_ai.tool.stdout"] !== undefined ||
      envelope["gen_ai.tool.stderr"] !== undefined)
  ) {
    return "codex.agent.tool";
  }
  return row.provider === "codex_cli" || row.provider === "codex_sdk"
    ? "codex.agent.turn"
    : "gen_ai.chat";
}

export function archivedRowsToInternalSpans(
  rows: readonly ArchivedSpanIndexRow[],
  envelopes: ReadonlyMap<string, Record<string, unknown>>,
): InternalSpan[] {
  return rows.map((row): InternalSpan => {
    const envelope = envelopes.get(row.s3Key) ?? envelopes.get(row.spanId);
    const attrs: Record<string, unknown> = {
      "gen_ai.system": row.provider,
      "gen_ai.provider.name": row.provider,
      "llm.service": row.service,
      "llm.call_site": row.callSite,
      "gen_ai.usage.input_tokens": row.inputTokens,
      "gen_ai.usage.output_tokens": row.outputTokens,
      "gen_ai.usage.cache_read_input_tokens": row.cacheReadTokens,
      "gen_ai.usage.cache_creation_input_tokens": row.cacheCreationTokens,
      "llm.archive.s3_key": row.s3Key,
      "llm.archive.bytes_compressed": row.bytesCompressed,
      "llm.archive.bytes_uncompressed": row.bytesUncompressed,
      "llm.archive.status": "ok",
    };
    if (row.requestModel !== null) {
      attrs["gen_ai.request.model"] = row.requestModel;
    }
    if (row.responseModel !== null) {
      attrs["gen_ai.response.model"] = row.responseModel;
    }
    if (row.responseId !== null) {
      attrs["gen_ai.response.id"] = row.responseId;
    }
    if (row.finishReason !== null) {
      attrs["gen_ai.response.finish_reasons"] = [row.finishReason];
    }

    return {
      spanId: row.spanId,
      parentSpanId: null,
      name: inferArchivedSpanName(row, envelope),
      service: row.service,
      scopeName: null,
      startedAtMs: row.capturedAtMs,
      endedAtMs: row.capturedAtMs,
      durationMs: null,
      status: row.finishReason === "error" ? "error" : "ok",
      statusMessage: null,
      attributes: attrs,
      resourceAttributes: { "service.name": row.service },
      envelope,
      archiveKey: row.s3Key,
      events: [],
    };
  });
}
