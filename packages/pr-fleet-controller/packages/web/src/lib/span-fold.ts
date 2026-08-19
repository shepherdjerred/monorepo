import { z } from "zod";
import type { RunView, SpanRecord, TimelineItem } from "./fold.ts";

const SpanRecordSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  type: z.string(),
  entityName: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  attributes: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  errorInfo: z.unknown().optional(),
  isRootSpan: z.boolean().optional(),
});
const LegacySpanLineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("span"), span: SpanRecordSchema }),
  z.object({ kind: z.literal("metric"), metric: z.unknown() }),
]);

const HrTimeSchema = z.tuple([z.number(), z.number()]);
const OtelSpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  startTime: HrTimeSchema,
  duration: HrTimeSchema,
  status: z.object({ code: z.number(), message: z.string().optional() }),
  attributes: z.record(z.string(), z.unknown()),
  events: z.array(z.unknown()),
});
const OtelSpanLineSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("span"),
  span: OtelSpanSchema,
});
const SpanLineSchema = z.union([LegacySpanLineSchema, OtelSpanLineSchema]);

function prView(view: RunView, prNumber: number) {
  const existing = view.prs.get(prNumber);
  if (existing !== undefined) {
    return existing;
  }
  const timeline: TimelineItem[] = [];
  const created = {
    number: prNumber,
    timeline,
    spanIds: new Set<string>(),
  };
  view.prs.set(prNumber, created);
  return created;
}

function spanPrNumber(view: RunView, span: SpanRecord): number | undefined {
  const raw = span.metadata?.["prNumber"];
  const parsed = z.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data : view.tracePrNumbers.get(span.traceId);
}

function applySpan(view: RunView, span: SpanRecord): void {
  const item: TimelineItem = {
    kind: "span",
    t: parsedEpoch(span.endTime ?? span.startTime),
    order: view.counter++,
    span,
  };
  const prNumber = spanPrNumber(view, span);
  if (prNumber === undefined) {
    if (view.fleetSpanIds.has(span.id)) {
      return;
    }
    view.fleetSpanIds.add(span.id);
    view.fleetTimeline.push(item);
    return;
  }
  const pr = prView(view, prNumber);
  if (pr.spanIds.has(span.id)) {
    return;
  }
  pr.spanIds.add(span.id);
  pr.timeline.push(item);
}

function parsedEpoch(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? 0 : epoch;
}

export function applySpanLine(view: RunView, raw: string): void {
  const line = SpanLineSchema.parse(JSON.parse(raw));
  if (line.kind === "span") {
    applySpan(
      view,
      "schemaVersion" in line ? normalizeOtelSpan(line.span) : line.span,
    );
  }
  // Metric lines are captured for completeness but not rendered per-PR: metric
  // labels intentionally omit trace/run ids, so they cannot be joined to a PR.
  // Token/cost is surfaced from each model span's attributes instead.
}

function hrTimeMilliseconds(time: readonly [number, number]): number {
  return time[0] * 1000 + time[1] / 1_000_000;
}

function normalizeOtelSpan(span: z.infer<typeof OtelSpanSchema>): SpanRecord {
  const startMs = hrTimeMilliseconds(span.startTime);
  const durationMs = hrTimeMilliseconds(span.duration);
  return SpanRecordSchema.parse({
    id: span.spanId,
    traceId: span.traceId,
    ...(span.parentSpanId === undefined
      ? {}
      : { parentSpanId: span.parentSpanId }),
    name: span.name,
    type:
      span.name.includes("tool") || span.name.includes("Tool")
        ? "tool_call"
        : "model_inference",
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(startMs + durationMs).toISOString(),
    attributes: span.attributes,
    output: { status: span.status, events: span.events },
  });
}
