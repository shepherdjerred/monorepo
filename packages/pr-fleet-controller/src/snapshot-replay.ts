import { z } from "zod";
import type { RecordedRunEvent, RunSummary } from "./run-events.ts";
import { canonicalJson } from "./run-hashing.ts";
import {
  FleetSnapshotSchema,
  FleetTickReportSchema,
  type FleetSnapshot,
} from "./schemas.ts";

const TickCompletedPayloadSchema = z.object({ report: FleetTickReportSchema });
const SnapshotPayloadSchema = z.object({ snapshot: FleetSnapshotSchema });
const ACTIVE_STATUSES = new Set([
  "diagnosing",
  "editing",
  "verifying",
  "waiting-write-lease",
]);

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

export function replaySnapshots(
  events: RecordedRunEvent[],
  summary: RunSummary,
): FleetSnapshot | null {
  const tickSnapshots = new Map<string, FleetSnapshot>();
  const activeTickIds = new Set<string>();
  let finalSnapshot: FleetSnapshot | null = null;
  for (const event of events) {
    if (event.kind === "tick.started") {
      const tickId = event.correlation.tickId;
      if (tickId !== undefined) {
        activeTickIds.add(tickId);
      }
    }
    if (event.kind === "fleet.snapshot") {
      const tickId = event.correlation.tickId;
      if (tickId === undefined || !activeTickIds.has(tickId)) {
        throw new Error(
          `fleet.snapshot references a nonexistent or inactive tick: ${tickId ?? "missing"}`,
        );
      }
      const parsed = SnapshotPayloadSchema.parse(event.payload).snapshot;
      verifySnapshot(parsed);
      finalSnapshot = parsed;
      tickSnapshots.set(tickId, parsed);
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
      if (event.correlation.tickId !== undefined) {
        tickSnapshots.delete(event.correlation.tickId);
        activeTickIds.delete(event.correlation.tickId);
      }
    }
    if (
      event.kind === "tick.failed" &&
      event.correlation.tickId !== undefined
    ) {
      tickSnapshots.delete(event.correlation.tickId);
      activeTickIds.delete(event.correlation.tickId);
    }
    if (
      event.kind === "shutdown.completed" ||
      event.kind === "shutdown.failed"
    ) {
      finalSnapshot = SnapshotPayloadSchema.parse(event.payload).snapshot;
      verifySnapshot(finalSnapshot);
    }
  }
  if (canonicalJson(finalSnapshot) !== canonicalJson(summary.finalSnapshot)) {
    throw new Error("Summary final snapshot does not match replayed state");
  }
  return finalSnapshot;
}

export function verifyShutdownBoundary(events: RecordedRunEvent[]): void {
  const shutdownTerminalIndex = events.findIndex(
    (event) =>
      event.kind === "shutdown.completed" || event.kind === "shutdown.failed",
  );
  if (shutdownTerminalIndex === -1) {
    return;
  }
  const lateEvent = events
    .slice(shutdownTerminalIndex + 1)
    .find(
      (event) => event.kind !== "run.completed" && event.kind !== "run.failed",
    );
  if (lateEvent !== undefined) {
    throw new Error(`${lateEvent.kind} was recorded after shutdown terminal`);
  }
}
