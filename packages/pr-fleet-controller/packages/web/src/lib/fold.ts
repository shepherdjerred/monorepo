import { z } from "zod";
import {
  RecordedRunEventSchema,
  type RecordedRunEvent,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import {
  FleetSnapshotSchema,
  type FleetSnapshot,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import {
  FleetFailureClassSchema,
  ProgressPayloadSchemas,
} from "@shepherdjerred/pr-fleet-controller/src/progress-events.ts";

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
export type SpanRecord = z.infer<typeof SpanRecordSchema>;

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

export type TimelineItem =
  | { kind: "event"; t: number; order: number; event: RecordedRunEvent }
  | { kind: "span"; t: number; order: number; span: SpanRecord };

export type PrView = {
  number: number;
  timeline: TimelineItem[];
  spanIds: Set<string>;
};

export type ProgressUpdate = {
  label: string;
  timestamp: string;
};

export type PrProgress = {
  latest: ProgressUpdate | null;
  blocker:
    | (ProgressUpdate & { failureClass: string; repeatCount: number })
    | null;
  failures: Map<string, number>;
};

export type FleetProgress = {
  setupsCompleted: number;
  publicationsConfirmed: number;
  leaseDenials: number;
  failures: Map<string, number>;
  prs: Map<number, PrProgress>;
};

export type RunStatus = "live" | "completed" | "failed";

export type RunView = {
  fleet: FleetSnapshot | null;
  prs: Map<number, PrView>;
  fleetTimeline: TimelineItem[];
  fleetSpanIds: Set<string>;
  tracePrNumbers: Map<string, number>;
  lastEventSeq: number;
  runStatus: RunStatus;
  progress: FleetProgress;
  counter: number;
};

export function createRunView(): RunView {
  return {
    fleet: null,
    prs: new Map(),
    fleetTimeline: [],
    fleetSpanIds: new Set(),
    tracePrNumbers: new Map(),
    lastEventSeq: 0,
    runStatus: "live",
    progress: {
      setupsCompleted: 0,
      publicationsConfirmed: 0,
      leaseDenials: 0,
      failures: new Map(),
      prs: new Map(),
    },
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

function prProgress(view: RunView, prNumber: number): PrProgress {
  const existing = view.progress.prs.get(prNumber);
  if (existing !== undefined) {
    return existing;
  }
  const created: PrProgress = {
    latest: null,
    blocker: null,
    failures: new Map(),
  };
  view.progress.prs.set(prNumber, created);
  return created;
}

function failureLabel(failureClass: string): string {
  const labels: Record<string, string> = {
    "setup-required": "Setup required",
    "lease-unavailable": "Lease unavailable",
    "worktree-head-changed": "Worktree HEAD changed",
    "restack-required": "Restack required",
    "invalid-commit-scope": "Invalid commit scope",
    "hook-failed": "Commit hook failed",
    "publication-context": "Publication context changed",
    "command-timeout": "Command timed out",
    "command-aborted": "Command aborted",
    "operator-input-required": "Operator input required",
    unknown: "Unclassified failure",
  };
  return labels[failureClass] ?? failureClass;
}

function updateLatest(
  progress: PrProgress,
  timestamp: string,
  label: string,
): void {
  progress.latest = { timestamp, label };
}

function recordFailure(
  view: RunView,
  prNumber: number,
  timestamp: string,
  failureClass: string,
): void {
  const progress = prProgress(view, prNumber);
  const repeatCount = (progress.failures.get(failureClass) ?? 0) + 1;
  progress.failures.set(failureClass, repeatCount);
  view.progress.failures.set(
    failureClass,
    (view.progress.failures.get(failureClass) ?? 0) + 1,
  );
  const label = failureLabel(failureClass);
  progress.blocker = { timestamp, label, failureClass, repeatCount };
  updateLatest(progress, timestamp, label);
}

function applyLeaseDenial(
  view: RunView,
  event: RecordedRunEvent,
  prNumber: number,
  progress: PrProgress,
): void {
  const parsed = ProgressPayloadSchemas["lease.denied"].safeParse(
    event.payload,
  );
  if (!parsed.success) {
    return;
  }
  view.progress.leaseDenials += 1;
  updateLatest(
    progress,
    event.timestamp,
    `Waiting for ${parsed.data.kind} lease`,
  );
  recordFailure(view, prNumber, event.timestamp, "lease-unavailable");
}

function applySetupProgress(
  view: RunView,
  event: RecordedRunEvent,
  prNumber: number,
  progress: PrProgress,
): boolean {
  if (event.kind === "setup.required") {
    const parsed = ProgressPayloadSchemas["setup.required"].safeParse(
      event.payload,
    );
    if (parsed.success) {
      recordFailure(view, prNumber, event.timestamp, "setup-required");
    }
    return true;
  }
  if (event.kind === "setup.started") {
    if (
      ProgressPayloadSchemas["setup.started"].safeParse(event.payload).success
    ) {
      updateLatest(progress, event.timestamp, "Setting up worktree");
    }
    return true;
  }
  if (event.kind === "setup.completed") {
    if (
      ProgressPayloadSchemas["setup.completed"].safeParse(event.payload).success
    ) {
      view.progress.setupsCompleted += 1;
      progress.blocker = null;
      updateLatest(progress, event.timestamp, "Worktree setup complete");
    }
    return true;
  }
  if (event.kind === "setup.failed") {
    const parsed = ProgressPayloadSchemas["setup.failed"].safeParse(
      event.payload,
    );
    if (parsed.success) {
      recordFailure(view, prNumber, event.timestamp, parsed.data.failureClass);
    }
    return true;
  }
  return false;
}

function applyPublicationProgress(
  view: RunView,
  event: RecordedRunEvent,
  progress: PrProgress,
): boolean {
  if (event.kind === "publication.stage") {
    const parsed = ProgressPayloadSchemas["publication.stage"].safeParse(
      event.payload,
    );
    if (!parsed.success) {
      return true;
    }
    const stage = `${parsed.data.intent} ${parsed.data.stage} ${parsed.data.state}`;
    updateLatest(progress, event.timestamp, stage);
    if (parsed.data.stage === "review" && parsed.data.state === "completed") {
      view.progress.publicationsConfirmed += 1;
      progress.blocker = null;
    }
    return true;
  }
  return false;
}

function applyHeadTransition(
  view: RunView,
  event: RecordedRunEvent,
  prNumber: number,
  progress: PrProgress,
): void {
  if (event.kind === "worktree.head.transition") {
    const parsed = ProgressPayloadSchemas["worktree.head.transition"].safeParse(
      event.payload,
    );
    if (!parsed.success) {
      return;
    }
    if (parsed.data.cause === "unexpected") {
      recordFailure(view, prNumber, event.timestamp, "worktree-head-changed");
      return;
    }
    updateLatest(
      progress,
      event.timestamp,
      `Recorded ${parsed.data.cause} HEAD transition`,
    );
  }
}

function applyProgressEvent(view: RunView, event: RecordedRunEvent): void {
  const prNumber = event.correlation.prNumber;
  if (prNumber === undefined) {
    return;
  }
  const progress = prProgress(view, prNumber);
  if (event.kind === "tool.failed") {
    const failureClass = FleetFailureClassSchema.safeParse(
      event.payload["failureClass"],
    );
    recordFailure(
      view,
      prNumber,
      event.timestamp,
      failureClass.success ? failureClass.data : "unknown",
    );
    return;
  }
  if (event.kind === "lease.denied") {
    applyLeaseDenial(view, event, prNumber, progress);
    return;
  }
  if (applySetupProgress(view, event, prNumber, progress)) {
    return;
  }
  if (applyPublicationProgress(view, event, progress)) {
    return;
  }
  applyHeadTransition(view, event, prNumber, progress);
}

function snapshotFromEvent(event: RecordedRunEvent): FleetSnapshot | null {
  const candidate =
    event.kind === "fleet.snapshot" ||
    event.kind === "shutdown.completed" ||
    event.kind === "shutdown.failed"
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

function applyEvent(view: RunView, event: RecordedRunEvent): void {
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
  applyProgressEvent(view, event);
  const item: TimelineItem = {
    kind: "event",
    t: parsedEpoch(event.timestamp),
    order: view.counter++,
    event,
  };
  const prNumber = event.correlation.prNumber;
  const traceId = event.correlation.traceId;
  if (prNumber !== undefined && traceId !== undefined) {
    view.tracePrNumbers.set(traceId, prNumber);
  }
  if (prNumber === undefined) {
    view.fleetTimeline.push(item);
  } else {
    prView(view, prNumber).timeline.push(item);
  }
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

export function applyEventLine(view: RunView, raw: string): void {
  applyEvent(view, RecordedRunEventSchema.parse(JSON.parse(raw)));
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

/** Timeline sorted by event time, ties broken by arrival order. */
export function sortedTimeline(items: readonly TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => a.t - b.t || a.order - b.order);
}
