import type { ArchiveConfig } from "@shepherdjerred/llm-observability";
import type {
  OtlpSpanShape,
  OtlpTraceShape,
} from "@shepherdjerred/llm-observability/trajectory";
import type { TraceSummary } from "@shepherdjerred/ops-clients/tempo.ts";
import type {
  ArchivedSpanIndexRow,
  TraceDetail,
  TraceListItem,
  TracesSearchQuery,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import { z } from "zod";

const LooseRecordSchema = z.record(z.string(), z.unknown());

export type ArchiveReaderFn = (
  config: ArchiveConfig,
  key: string,
) => Promise<string | undefined>;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.trunc(concurrency));
  const results: R[] = [];
  let cursor = 0;

  async function runLane(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () =>
    runLane(),
  );
  await Promise.all(lanes);
  return results;
}

function hasInlineInputBody(attrs: Readonly<Record<string, unknown>>): boolean {
  return (
    attrs["gen_ai.input.messages"] !== undefined ||
    attrs["ai.prompt.messages"] !== undefined ||
    attrs["ai.prompt"] !== undefined ||
    attrs["ai.value"] !== undefined ||
    attrs["ai.values"] !== undefined
  );
}

function hasInlineOutputBody(
  attrs: Readonly<Record<string, unknown>>,
): boolean {
  return (
    attrs["gen_ai.output.messages"] !== undefined ||
    attrs["ai.response.text"] !== undefined ||
    attrs["ai.response.object"] !== undefined ||
    attrs["ai.embedding"] !== undefined ||
    attrs["ai.embeddings"] !== undefined
  );
}

export function archiveKeyNeedingHydration(span: OtlpSpanShape): string | null {
  const rawKey = span.attributes["llm.archive.s3_key"];
  if (typeof rawKey !== "string" || rawKey.trim() === "") {
    return null;
  }
  if (span.name.endsWith(".tool")) {
    return span.attributes["gen_ai.tool.stdout"] === undefined ? rawKey : null;
  }
  return hasInlineInputBody(span.attributes) &&
    hasInlineOutputBody(span.attributes)
    ? null
    : rawKey;
}

function parseEnvelopeJson(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const checked = LooseRecordSchema.safeParse(parsed);
    return checked.success ? checked.data : undefined;
  } catch {
    return undefined;
  }
}

export async function hydrateOtlpEnvelopes(
  trace: OtlpTraceShape,
  archive: ArchiveConfig | null,
  archiveReader: ArchiveReaderFn,
): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (archive === null) {
    return result;
  }
  const keys = [
    ...new Set(
      trace.spans.flatMap((span) => {
        const key = archiveKeyNeedingHydration(span);
        return key === null ? [] : [key];
      }),
    ),
  ];
  await mapWithConcurrency(keys, 8, async (key) => {
    try {
      const raw = await archiveReader(archive, key);
      const parsed = parseEnvelopeJson(raw);
      if (parsed !== undefined) {
        result.set(key, parsed);
      }
    } catch {
      // Tempo span attributes remain available when archive hydration fails.
    }
  });
  return result;
}

export async function readArchivedEnvelopes(
  rows: readonly ArchivedSpanIndexRow[],
  archive: ArchiveConfig | null,
  archiveReader: ArchiveReaderFn,
): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (archive === null) {
    return result;
  }
  const uniqueKeys = [...new Set(rows.map((row) => row.s3Key))];
  await mapWithConcurrency(uniqueKeys, 8, async (key) => {
    try {
      const raw = await archiveReader(archive, key);
      const parsed = parseEnvelopeJson(raw);
      if (parsed !== undefined) {
        result.set(key, parsed);
      }
    } catch {
      // Metadata-only archived rendering still succeeds when S3 read fails.
    }
  });
  return result;
}

function uniqueStrings(
  lists: readonly (readonly string[] | undefined)[],
): string[] {
  const seen = new Set<string>();
  for (const list of lists) {
    if (list === undefined) continue;
    for (const entry of list) {
      if (entry !== "") {
        seen.add(entry);
      }
    }
  }
  return [...seen];
}

function pickNullable<T>(
  primary: T | null | undefined,
  fallback: T | null | undefined,
): T | null {
  return primary ?? fallback ?? null;
}

function pickDefault<T>(
  primary: T | undefined,
  fallback: T | undefined,
  defaultValue: T,
): T {
  return primary ?? fallback ?? defaultValue;
}

export function mergeTempoItem(
  summary: TraceSummary,
  indexed: TraceListItem | undefined,
): TraceListItem {
  return {
    traceId: summary.traceId,
    source: "tempo",
    startedAtMs: Math.max(0, Math.round(summary.startedAt.getTime())),
    durationMs: Math.max(0, summary.durationMs),
    spanCount: pickDefault(summary.spanCount, indexed?.spanCount, 1),
    errorCount: pickDefault(summary.errorCount, indexed?.errorCount, 0),
    service: pickDefault(summary.rootServiceName, indexed?.service, "unknown"),
    environment: pickNullable(summary.environment, indexed?.environment),
    rootSpanName: pickNullable(summary.rootTraceName, indexed?.rootSpanName),
    workloads: uniqueStrings([summary.workloads, indexed?.workloads]),
    providers: uniqueStrings([summary.providers, indexed?.providers]),
    models: uniqueStrings([summary.models, indexed?.models]),
    subject: pickNullable(summary.subject, indexed?.subject),
    inputTokens: pickNullable(summary.inputTokens, indexed?.inputTokens),
    outputTokens: pickNullable(summary.outputTokens, indexed?.outputTokens),
    cachedInputTokens: pickNullable(
      summary.cachedInputTokens,
      indexed?.cachedInputTokens,
    ),
    hasToolIo: Boolean(summary.hasToolIo) || Boolean(indexed?.hasToolIo),
  };
}

export function detailToListItem(
  detail: TraceDetail,
  indexed: TraceListItem | undefined,
): TraceListItem {
  const hasToolIo =
    Boolean(indexed?.hasToolIo) ||
    detail.trajectory.some(
      (item) =>
        (item.shape === "codex-agent" && item.commands.length > 0) ||
        (item.shape === "ai-sdk-chat" &&
          [...item.messages, ...item.outputMessages].some((msg) =>
            msg.parts.some(
              (part) =>
                part.kind === "tool-call" || part.kind === "tool-result",
            ),
          )),
    );

  return {
    traceId: detail.traceId,
    source: detail.source,
    startedAtMs: Math.round(detail.startedAtMs),
    durationMs: detail.durationMs,
    spanCount: detail.spanCount,
    errorCount: detail.errorSpanCount,
    service: detail.rootService,
    environment: pickNullable(detail.environment, indexed?.environment),
    rootSpanName: detail.rootSpanName,
    workloads: uniqueStrings([detail.workloads, indexed?.workloads]),
    providers: uniqueStrings([detail.providers, indexed?.providers]),
    models: uniqueStrings([detail.models, indexed?.models]),
    subject: pickNullable(detail.subject, indexed?.subject),
    inputTokens: detail.totals.inputTokens,
    outputTokens: detail.totals.outputTokens,
    cachedInputTokens: detail.totals.cachedInputTokens,
    hasToolIo,
  };
}

function matchesScalarFilter(
  expected: string | undefined,
  actual: string | null | undefined,
): boolean {
  return expected === undefined || actual === expected;
}

function matchesListFilter(
  expected: string | undefined,
  values: readonly string[],
): boolean {
  return expected === undefined || values.includes(expected);
}

export function matchesDirectTraceFilters(
  item: TraceListItem,
  query: TracesSearchQuery,
): boolean {
  const checks = [
    matchesScalarFilter(query.service, item.service),
    matchesScalarFilter(query.environment, item.environment),
    matchesListFilter(query.workload, item.workloads),
    matchesListFilter(query.provider, item.providers),
    matchesListFilter(query.model, item.models),
    matchesScalarFilter(query.subjectId, item.subject?.id),
    query.status !== "error" || item.errorCount > 0,
    query.status !== "ok" || item.errorCount === 0,
  ];
  return checks.every(Boolean);
}

export function matchesTextQuery(
  item: TraceListItem,
  rawQuery: string | undefined,
): boolean {
  if (rawQuery === undefined || rawQuery.trim() === "") {
    return true;
  }
  const needle = rawQuery.trim().toLowerCase();
  const haystacks = [
    item.traceId,
    item.service,
    item.rootSpanName ?? "",
    item.environment ?? "",
    item.subject === null ? "" : `${item.subject.kind}:${item.subject.id}`,
    ...item.workloads,
    ...item.providers,
    ...item.models,
  ];
  return haystacks.some((field) => field.toLowerCase().includes(needle));
}
