import { z } from "zod";
import {
  RecordedRunEventSchema,
  type RecordedRunEvent,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import {
  FleetSnapshotSchema,
  type FleetSnapshot,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

/**
 * A completed Mastra span as mirrored into `spans.jsonl`. Dates were serialized
 * to ISO strings. Lenient by design — this is an observability convenience
 * stream, so unknown/extra fields are tolerated.
 */
export const SpanRecordSchema = z.object({
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
export type SpanRecord = z.infer<typeof SpanRecordSchema>;

export const SpanLineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("span"), span: SpanRecordSchema }),
  z.object({ kind: z.literal("metric"), metric: z.unknown() }),
]);

export type TimelineItem =
  | { kind: "event"; t: number; order: number; event: RecordedRunEvent }
  | { kind: "span"; t: number; order: number; span: SpanRecord };

export type PrView = {
  number: number;
  timeline: TimelineItem[];
  spanIds: Set<string>;
};

export type RunStatus = "live" | "completed" | "failed";

export type RunView = {
  fleet: FleetSnapshot | null;
  prs: Map<number, PrView>;
  fleetTimeline: TimelineItem[];
  fleetSpanIds: Set<string>;
  lastEventSeq: number;
  runStatus: RunStatus;
  counter: number;
};

export function createRunView(): RunView {
  return {
    fleet: null,
    prs: new Map(),
    fleetTimeline: [],
    fleetSpanIds: new Set(),
    lastEventSeq: 0,
    runStatus: "live",
    counter: 0,
  };
}

function prView(view: RunView, prNumber: number): PrView {
  const existing = view.prs.get(prNumber);
  if (existing !== undefined) {
    return existing;
  }
  const created: PrView = {
    number: prNumber,
    timeline: [],
    spanIds: new Set(),
  };
  view.prs.set(prNumber, created);
  return created;
}

function snapshotFromEvent(event: RecordedRunEvent): FleetSnapshot | null {
  const candidate =
    event.kind === "fleet.snapshot" || event.kind === "shutdown.completed"
      ? event.payload["snapshot"]
      : event.kind === "tick.completed"
        ? extractReportSnapshot(event.payload["report"])
        : undefined;
  if (candidate === undefined) {
    return null;
  }
  const parsed = FleetSnapshotSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const ReportSnapshotSchema = z.object({ snapshot: z.unknown() });

function extractReportSnapshot(report: unknown): unknown {
  const parsed = ReportSnapshotSchema.safeParse(report);
  return parsed.success ? parsed.data.snapshot : undefined;
}

function parsedEpoch(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? 0 : epoch;
}

export function applyEvent(view: RunView, event: RecordedRunEvent): void {
  // The SSE endpoint replays the full history on every (re)connect. Sequences
  // are strictly increasing, so skipping any at-or-below the high-water mark
  // makes reconnects idempotent without a per-event id set.
  if (event.sequence <= view.lastEventSeq) {
    return;
  }
  view.lastEventSeq = event.sequence;
  const snapshot = snapshotFromEvent(event);
  if (snapshot !== null) {
    view.fleet = snapshot;
  }
  if (event.kind === "run.completed") {
    view.runStatus = "completed";
  } else if (event.kind === "run.failed") {
    view.runStatus = "failed";
  }
  const item: TimelineItem = {
    kind: "event",
    t: parsedEpoch(event.timestamp),
    order: view.counter++,
    event,
  };
  const prNumber = event.correlation.prNumber;
  if (prNumber === undefined) {
    view.fleetTimeline.push(item);
  } else {
    prView(view, prNumber).timeline.push(item);
  }
}

function spanPrNumber(span: SpanRecord): number | undefined {
  const raw = span.metadata?.["prNumber"];
  const parsed = z.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function applySpan(view: RunView, span: SpanRecord): void {
  const item: TimelineItem = {
    kind: "span",
    t: parsedEpoch(span.endTime ?? span.startTime),
    order: view.counter++,
    span,
  };
  const prNumber = spanPrNumber(span);
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

export function applyEventLine(view: RunView, raw: string): void {
  applyEvent(view, RecordedRunEventSchema.parse(JSON.parse(raw)));
}

export function applySpanLine(view: RunView, raw: string): void {
  const line = SpanLineSchema.parse(JSON.parse(raw));
  if (line.kind === "span") {
    applySpan(view, line.span);
  }
  // Metric lines are captured for completeness but not rendered per-PR: metric
  // labels intentionally omit trace/run ids, so they cannot be joined to a PR.
  // Token/cost is surfaced from each model span's attributes instead.
}

/** Timeline sorted by event time, ties broken by arrival order. */
export function sortedTimeline(items: readonly TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => a.t - b.t || a.order - b.order);
}
