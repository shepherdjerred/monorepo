import { z } from "zod";
import {
  JsonValueSchema,
  RunEventPayloadSchema,
  RunSummarySchema,
  type JsonValue,
  type RecordedRunEvent,
  type RunManifest,
  type RunSummary,
} from "./run-events.ts";
import {
  canonicalJson,
  readAndVerifyEvents,
  readRunManifest,
  readRunSummary,
} from "./run-recorder.ts";
import {
  FleetSnapshotSchema,
  FleetTickReportSchema,
  type FleetSnapshot,
} from "./schemas.ts";

const TickCompletedPayloadSchema = z.object({ report: FleetTickReportSchema });
const SnapshotPayloadSchema = z.object({ snapshot: FleetSnapshotSchema });

const BODY_FIELD_PATTERN =
  /^(?:body|content|line|log|message|messages|output|patch|prompt|response|stderr|stdout|text)$/i;
const ACTIVE_STATUSES = new Set([
  "diagnosing",
  "editing",
  "verifying",
  "waiting-write-lease",
]);

export type RunBundle = {
  manifest: RunManifest;
  summary: RunSummary;
  events: RecordedRunEvent[];
};

export type ReplayLifecycle = {
  started: number;
  completed: number;
  cancelled: number;
  failed: number;
  open: string[];
};

export type ReplayReport = {
  runId: string;
  schemaVersion: number;
  controllerVersion: string;
  status: RunSummary["status"];
  eventCount: number;
  countsByKind: Record<string, number>;
  commands: ReplayLifecycle;
  tools: ReplayLifecycle;
  workers: ReplayLifecycle;
  workerAttempts: ReplayLifecycle;
  masterTurns: ReplayLifecycle;
  finalSnapshot: FleetSnapshot | null;
};

export async function loadRunBundle(runDirectory: string): Promise<RunBundle> {
  return {
    manifest: await readRunManifest(runDirectory),
    summary: await readRunSummary(runDirectory),
    events: await readAndVerifyEvents(runDirectory),
  };
}

function hideBodies(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => hideBodies(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        BODY_FIELD_PATTERN.test(key)
          ? "[hidden; pass --show-bodies]"
          : hideBodies(inner),
      ]),
    );
  }
  return value;
}

export function inspectEvents(
  events: RecordedRunEvent[],
  options: { prNumber?: number; showBodies: boolean },
): RecordedRunEvent[] {
  return events
    .filter(
      (event) =>
        options.prNumber === undefined ||
        event.correlation.prNumber === options.prNumber,
    )
    .map((event) => ({
      ...event,
      payload: options.showBodies
        ? event.payload
        : RunEventPayloadSchema.parse(hideBodies(event.payload)),
    }));
}

export function inspectRunSummary(
  summary: RunSummary,
  showBodies: boolean,
): RunSummary {
  if (showBodies) {
    return summary;
  }
  const json = JsonValueSchema.parse(summary);
  return RunSummarySchema.parse(hideBodies(json));
}

function lifecycleKey(
  event: RecordedRunEvent,
  category: "commands" | "tools" | "workers" | "modelTurns",
): string | null {
  switch (category) {
    case "commands":
      return event.correlation.commandId ?? null;
    case "tools":
      return event.correlation.toolCallId ?? null;
    case "workers":
      return event.correlation.prNumber === undefined ||
        event.correlation.generation === undefined
        ? null
        : `${String(event.correlation.prNumber)}:${String(event.correlation.generation)}`;
    case "modelTurns":
      return event.correlation.modelTurnId ?? null;
  }
}

function replayLifecycle(
  events: RecordedRunEvent[],
  category: "commands" | "tools" | "workers" | "modelTurns",
  kinds: {
    started: string;
    completed: string;
    cancelled?: string;
    failed: string;
  },
): ReplayLifecycle {
  const {
    started: startedKind,
    completed: completedKind,
    failed: failedKind,
  } = kinds;
  const open = new Set<string>();
  let started = 0;
  let completed = 0;
  let cancelled = 0;
  let failed = 0;
  for (const event of events) {
    if (
      event.kind !== startedKind &&
      event.kind !== completedKind &&
      event.kind !== failedKind &&
      event.kind !== kinds.cancelled
    ) {
      continue;
    }
    const key = lifecycleKey(event, category);
    if (key === null) {
      throw new Error(`${event.kind} is missing its lifecycle correlation ID`);
    }
    if (event.kind === startedKind) {
      if (open.has(key)) {
        throw new Error(`${startedKind} duplicated lifecycle ${key}`);
      }
      open.add(key);
      started += 1;
      continue;
    }
    if (!open.delete(key)) {
      throw new Error(`${event.kind} has no matching ${startedKind}: ${key}`);
    }
    if (event.kind === completedKind) {
      completed += 1;
    } else if (event.kind === kinds.cancelled) {
      cancelled += 1;
    } else {
      failed += 1;
    }
  }
  return { started, completed, cancelled, failed, open: [...open].sort() };
}

function countKinds(events: RecordedRunEvent[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function verifySnapshot(snapshot: FleetSnapshot): void {
  const numbers = snapshot.prs.map((pr) => pr.identity.number);
  if (new Set(numbers).size !== numbers.length) {
    throw new Error("Fleet snapshot contains duplicate PR numbers");
  }
  const expected = {
    open: snapshot.prs.length,
    green: snapshot.prs.filter((pr) => pr.classification === "green").length,
    active: snapshot.prs.filter((pr) => ACTIVE_STATUSES.has(pr.status)).length,
    queued: snapshot.prs.filter((pr) => pr.classification === "queued").length,
    pending: snapshot.prs.filter((pr) => pr.classification === "pending")
      .length,
    paused: snapshot.prs.filter((pr) => pr.classification === "paused").length,
  };
  const actual = {
    open: snapshot.open,
    green: snapshot.green,
    active: snapshot.active,
    queued: snapshot.queued,
    pending: snapshot.pending,
    paused: snapshot.paused,
  };
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(
      "Fleet snapshot aggregate counts diverge from its PR states",
    );
  }
}

export function replayRunBundle(
  bundle: RunBundle,
  options: { currentControllerVersion: string; allowVersionMismatch: boolean },
): ReplayReport {
  const { manifest, summary, events } = bundle;
  if (
    !options.allowVersionMismatch &&
    manifest.controllerVersion !== options.currentControllerVersion
  ) {
    throw new Error(
      `Controller version mismatch: run=${manifest.controllerVersion}, current=${options.currentControllerVersion}; pass --allow-version-mismatch to audit anyway`,
    );
  }
  if (summary.runId !== manifest.runId) {
    throw new Error("Manifest and summary run IDs differ");
  }
  if (summary.eventCount !== events.length) {
    throw new Error(
      `Summary event count ${String(summary.eventCount)} does not match JSONL count ${String(events.length)}`,
    );
  }
  const lastEvent = events.at(-1);
  if (lastEvent?.hash !== summary.lastHash) {
    throw new Error("Summary last hash does not match the final event");
  }
  const countsByKind = countKinds(events);
  if (canonicalJson(countsByKind) !== canonicalJson(summary.countsByKind)) {
    throw new Error("Summary event-kind counts do not match the event stream");
  }

  const tickSnapshots = new Map<string, FleetSnapshot>();
  let finalSnapshot: FleetSnapshot | null = null;
  for (const event of events) {
    if (event.kind === "fleet.snapshot") {
      const parsed = SnapshotPayloadSchema.parse(event.payload).snapshot;
      verifySnapshot(parsed);
      finalSnapshot = parsed;
      if (event.correlation.tickId !== undefined) {
        tickSnapshots.set(event.correlation.tickId, parsed);
      }
    }
    if (event.kind === "tick.completed") {
      const report = TickCompletedPayloadSchema.parse(event.payload).report;
      const recorded =
        event.correlation.tickId === undefined
          ? undefined
          : tickSnapshots.get(event.correlation.tickId);
      if (
        recorded === undefined ||
        canonicalJson(recorded) !== canonicalJson(report.snapshot)
      ) {
        throw new Error(
          `Tick ${event.correlation.tickId ?? "without-id"} completed with a snapshot not emitted by that tick`,
        );
      }
    }
    if (event.kind === "shutdown.completed") {
      finalSnapshot = SnapshotPayloadSchema.parse(event.payload).snapshot;
      verifySnapshot(finalSnapshot);
    }
  }
  if (canonicalJson(finalSnapshot) !== canonicalJson(summary.finalSnapshot)) {
    throw new Error("Summary final snapshot does not match replayed state");
  }

  const commands = replayLifecycle(events, "commands", {
    started: "command.started",
    completed: "command.completed",
    failed: "command.failed",
  });
  const tools = replayLifecycle(events, "tools", {
    started: "tool.started",
    completed: "tool.completed",
    failed: "tool.failed",
  });
  const workers = replayLifecycle(events, "workers", {
    started: "worker.started",
    completed: "worker.completed",
    cancelled: "worker.cancelled",
    failed: "worker.failed",
  });
  const workerAttempts = replayLifecycle(events, "modelTurns", {
    started: "worker.attempt.started",
    completed: "worker.attempt.completed",
    failed: "worker.attempt.failed",
  });
  const masterTurns = replayLifecycle(events, "modelTurns", {
    started: "master.turn.started",
    completed: "master.turn.completed",
    failed: "master.turn.failed",
  });
  if (summary.status === "completed") {
    const openLifecycles = Object.entries({
      commands,
      tools,
      workers,
      workerAttempts,
      masterTurns,
    })
      .filter(([, lifecycle]) => lifecycle.open.length > 0)
      .map(([name, lifecycle]) => `${name}=${lifecycle.open.join(",")}`);
    if (openLifecycles.length > 0) {
      throw new Error(
        `Completed run has open lifecycles: ${openLifecycles.join("; ")}`,
      );
    }
  }

  return {
    runId: manifest.runId,
    schemaVersion: manifest.schemaVersion,
    controllerVersion: manifest.controllerVersion,
    status: summary.status,
    eventCount: events.length,
    countsByKind,
    commands,
    tools,
    workers,
    workerAttempts,
    masterTurns,
    finalSnapshot,
  };
}
