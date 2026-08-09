import type { RecordedRunEvent } from "./run-events.ts";
import { z } from "zod";

const RefreshedEvidencePayloadSchema = z.object({
  operation: z.literal("refreshEvidence"),
});
const ListedPrsPayloadSchema = z.object({
  operation: z.literal("listOpenPrs"),
});

const EVIDENCE_TERMINAL_KINDS = new Set([
  "environment.result",
  "environment.failed",
]);

const PARENT_CORRELATION_FIELDS = [
  "traceId",
  "tickId",
  "prNumber",
  "headSha",
  "generation",
  "modelTurnId",
  "toolCallId",
] as const;

const TERMINAL_CORRELATION_FIELDS = [
  "traceId",
  "causationId",
  "tickId",
  "prNumber",
  "headSha",
  "generation",
  "modelTurnId",
  "toolCallId",
  "commandId",
] as const;

type LifecycleCategory = "commands" | "tools" | "workers" | "modelTurns";

function lifecycleKey(
  event: RecordedRunEvent,
  category: LifecycleCategory,
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

function requireLifecycleKey(
  event: RecordedRunEvent,
  category: LifecycleCategory,
): string {
  const key = lifecycleKey(event, category);
  if (key === null) {
    throw new Error(`${event.kind} is missing its lifecycle correlation ID`);
  }
  return key;
}

function verifyChildCorrelation(
  parent: RecordedRunEvent,
  child: RecordedRunEvent,
  relationship: string,
): void {
  for (const field of PARENT_CORRELATION_FIELDS) {
    const expected = parent.correlation[field];
    if (expected !== undefined && child.correlation[field] !== expected) {
      throw new Error(
        `${child.kind} has mismatched ${relationship} correlation field ${field}`,
      );
    }
  }
}

function requireActiveParent(
  active: Map<string, RecordedRunEvent>,
  key: string | undefined,
  child: RecordedRunEvent,
  relationship: string,
): RecordedRunEvent {
  if (key === undefined) {
    throw new Error(`${child.kind} is missing its ${relationship} correlation`);
  }
  const parent = active.get(key);
  if (parent === undefined) {
    throw new Error(
      `${child.kind} references a nonexistent or inactive ${relationship}: ${key}`,
    );
  }
  verifyChildCorrelation(parent, child, relationship);
  return parent;
}

function closeCorrelatedLifecycle(
  active: Map<string, RecordedRunEvent>,
  key: string,
  event: RecordedRunEvent,
  relationship: string,
): void {
  const started = requireActiveParent(active, key, event, relationship);
  for (const field of TERMINAL_CORRELATION_FIELDS) {
    if (event.correlation[field] !== started.correlation[field]) {
      throw new Error(
        `${event.kind} has mismatched ${relationship} correlation field ${field}`,
      );
    }
  }
  active.delete(key);
}

function ensureNoActiveChild(
  active: Map<string, RecordedRunEvent>,
  matchesParent: (event: RecordedRunEvent) => boolean,
  event: RecordedRunEvent,
  childKind: string,
): void {
  if ([...active.values()].some((child) => matchesParent(child))) {
    throw new Error(`${event.kind} closed before its active ${childKind}`);
  }
}

type ActiveCorrelations = {
  workers: Map<string, RecordedRunEvent>;
  modelTurns: Map<string, RecordedRunEvent>;
  tools: Map<string, RecordedRunEvent>;
  commands: Map<string, RecordedRunEvent>;
};

type TickCorrelations = {
  activeIds: Set<string>;
  failedDrainLanes: Map<string, Set<string>>;
  activeOperatorQuestionLanes: Set<string>;
};

function tickDrainLane(event: RecordedRunEvent): string | null {
  const prNumber = event.correlation.prNumber;
  const headSha = event.correlation.headSha;
  return prNumber === undefined || headSha === undefined
    ? null
    : `${String(prNumber)}:${headSha}`;
}

function trackOperatorQuestionLane(
  event: RecordedRunEvent,
  activeOperatorQuestionLanes: Set<string>,
): void {
  const lane = tickDrainLane(event);
  if (lane === null) return;
  if (event.kind === "operator.question.asked") {
    activeOperatorQuestionLanes.add(lane);
  }
  if (
    event.kind === "operator.question.answered" ||
    event.kind === "operator.question.superseded"
  ) {
    activeOperatorQuestionLanes.delete(lane);
  }
}

function verifyTickCausation(
  event: RecordedRunEvent,
  ticks: TickCorrelations,
): void {
  if (EVIDENCE_TERMINAL_KINDS.has(event.kind)) {
    const tickId = event.correlation.tickId;
    const lane = tickDrainLane(event);
    const draining =
      tickId !== undefined &&
      lane !== null &&
      ticks.failedDrainLanes.get(tickId)?.has(lane) === true;
    const operatorHeadLookup =
      tickId === undefined &&
      lane !== null &&
      ticks.activeOperatorQuestionLanes.has(lane) &&
      ListedPrsPayloadSchema.safeParse(event.payload).success;
    if (operatorHeadLookup) return;
    if (tickId === undefined || (!draining && !ticks.activeIds.has(tickId))) {
      throw new Error(
        `${event.kind} references a nonexistent or inactive tick: ${tickId ?? "missing"}`,
      );
    }
    return;
  }
  if (event.kind !== "fleet.change" && event.kind !== "tick.queued") {
    return;
  }
  const correlationField =
    event.kind === "fleet.change" ? "tickId" : "causationId";
  const tickId = event.correlation[correlationField];
  if (tickId === undefined || !ticks.activeIds.has(tickId)) {
    throw new Error(
      `${event.kind} references a nonexistent or inactive tick: ${tickId ?? "missing"}`,
    );
  }
}

function trackCommandStarted(
  event: RecordedRunEvent,
  active: ActiveCorrelations,
  activeTickIds: Set<string>,
  failedTickDrainLanes: Map<string, Set<string>>,
): void {
  const tickId = event.correlation.tickId;
  const requiresActiveTick =
    tickId !== undefined && event.correlation.generation === undefined;
  const lane = tickDrainLane(event);
  if (lane !== null && tickId !== undefined && activeTickIds.has(tickId)) {
    failedTickDrainLanes.get(tickId)?.add(lane);
  }
  const draining =
    tickId !== undefined &&
    lane !== null &&
    failedTickDrainLanes.get(tickId)?.has(lane) === true;
  if (!draining && requiresActiveTick && !activeTickIds.has(tickId)) {
    throw new Error(
      `command.started references a nonexistent or inactive tick: ${tickId}`,
    );
  }
  if (event.correlation.toolCallId !== undefined) {
    requireActiveParent(
      active.tools,
      event.correlation.toolCallId,
      event,
      "tool",
    );
  }
  if (event.correlation.modelTurnId !== undefined) {
    requireActiveParent(
      active.modelTurns,
      event.correlation.modelTurnId,
      event,
      "model turn",
    );
  }
  if (event.correlation.generation !== undefined) {
    requireActiveParent(
      active.workers,
      requireLifecycleKey(event, "workers"),
      event,
      "worker",
    );
  }
  active.commands.set(requireLifecycleKey(event, "commands"), event);
}

function trackStartedEvent(
  event: RecordedRunEvent,
  active: ActiveCorrelations,
  ticks: TickCorrelations,
): void {
  verifyTickCausation(event, ticks);
  if (event.kind === "tick.started") {
    const tickId = event.correlation.tickId;
    if (tickId === undefined) {
      throw new Error("tick.started is missing its tick correlation");
    }
    ticks.activeIds.add(tickId);
    ticks.failedDrainLanes.set(tickId, new Set());
  }
  if (event.kind === "worker.started") {
    const tickId = event.correlation.tickId;
    if (tickId === undefined) {
      throw new Error("worker.started is missing its tick correlation");
    }
    if (!ticks.activeIds.has(tickId)) {
      throw new Error(
        `worker.started references a nonexistent or inactive tick: ${tickId}`,
      );
    }
    active.workers.set(requireLifecycleKey(event, "workers"), event);
  }
  if (event.kind === "worker.attempt.started") {
    requireActiveParent(
      active.workers,
      requireLifecycleKey(event, "workers"),
      event,
      "worker",
    );
    active.modelTurns.set(requireLifecycleKey(event, "modelTurns"), event);
  }
  if (event.kind === "master.turn.started") {
    active.modelTurns.set(requireLifecycleKey(event, "modelTurns"), event);
  }
  if (event.kind === "master.text") {
    requireActiveParent(
      active.modelTurns,
      event.correlation.modelTurnId,
      event,
      "model turn",
    );
  }
  if (event.kind === "tool.started") {
    requireActiveParent(
      active.modelTurns,
      event.correlation.modelTurnId,
      event,
      "model turn",
    );
    if (event.correlation.generation !== undefined) {
      requireActiveParent(
        active.workers,
        requireLifecycleKey(event, "workers"),
        event,
        "worker",
      );
    }
    active.tools.set(requireLifecycleKey(event, "tools"), event);
  }
  if (event.kind === "command.started") {
    trackCommandStarted(event, active, ticks.activeIds, ticks.failedDrainLanes);
  }
}

function closeFailedTickDrainLane(
  event: RecordedRunEvent,
  activeTickIds: Set<string>,
  failedTickDrainLanes: Map<string, Set<string>>,
): void {
  if (!EVIDENCE_TERMINAL_KINDS.has(event.kind)) return;
  const tickId = event.correlation.tickId;
  const lane = tickDrainLane(event);
  if (
    tickId === undefined ||
    lane === null ||
    !RefreshedEvidencePayloadSchema.safeParse(event.payload).success
  ) {
    return;
  }
  const lanes = failedTickDrainLanes.get(tickId);
  lanes?.delete(lane);
  if (lanes?.size === 0 && !activeTickIds.has(tickId)) {
    failedTickDrainLanes.delete(tickId);
  }
}

function closeTickLifecycle(
  event: RecordedRunEvent,
  activeTickIds: Set<string>,
  failedTickDrainLanes: Map<string, Set<string>>,
): void {
  if (event.kind !== "tick.completed" && event.kind !== "tick.failed") return;
  const closedTickId = event.correlation.tickId;
  if (closedTickId === undefined) return;
  if (event.kind === "tick.completed") {
    failedTickDrainLanes.delete(closedTickId);
  }
  activeTickIds.delete(closedTickId);
}

function closeTerminalEvent(
  event: RecordedRunEvent,
  active: ActiveCorrelations,
  activeTickIds: Set<string>,
  failedTickDrainLanes: Map<string, Set<string>>,
): void {
  closeFailedTickDrainLane(event, activeTickIds, failedTickDrainLanes);
  closeTickLifecycle(event, activeTickIds, failedTickDrainLanes);
  if (event.kind === "command.completed" || event.kind === "command.failed") {
    closeCorrelatedLifecycle(
      active.commands,
      requireLifecycleKey(event, "commands"),
      event,
      "command start",
    );
  }
  if (event.kind === "tool.completed" || event.kind === "tool.failed") {
    const toolCallId = requireLifecycleKey(event, "tools");
    ensureNoActiveChild(
      active.commands,
      (child) => child.correlation.toolCallId === toolCallId,
      event,
      "command",
    );
    closeCorrelatedLifecycle(active.tools, toolCallId, event, "tool start");
  }
  if (
    event.kind === "worker.attempt.completed" ||
    event.kind === "worker.attempt.failed" ||
    event.kind === "master.turn.completed" ||
    event.kind === "master.turn.failed"
  ) {
    const modelTurnId = requireLifecycleKey(event, "modelTurns");
    ensureNoActiveChild(
      active.tools,
      (child) => child.correlation.modelTurnId === modelTurnId,
      event,
      "tool",
    );
    ensureNoActiveChild(
      active.commands,
      (child) => child.correlation.modelTurnId === modelTurnId,
      event,
      "command",
    );
    closeCorrelatedLifecycle(
      active.modelTurns,
      modelTurnId,
      event,
      "model turn start",
    );
  }
  if (
    event.kind === "worker.completed" ||
    event.kind === "worker.cancelled" ||
    event.kind === "worker.failed"
  ) {
    const workerKey = requireLifecycleKey(event, "workers");
    ensureNoActiveChild(
      active.modelTurns,
      (child) => lifecycleKey(child, "workers") === workerKey,
      event,
      "model turn",
    );
    ensureNoActiveChild(
      active.tools,
      (child) => lifecycleKey(child, "workers") === workerKey,
      event,
      "tool",
    );
    ensureNoActiveChild(
      active.commands,
      (child) => lifecycleKey(child, "workers") === workerKey,
      event,
      "command",
    );
    closeCorrelatedLifecycle(active.workers, workerKey, event, "worker start");
  }
}

export function verifyCorrelationGraph(events: RecordedRunEvent[]): void {
  const ticks: TickCorrelations = {
    activeIds: new Set(),
    failedDrainLanes: new Map(),
    activeOperatorQuestionLanes: new Set(),
  };
  const active: ActiveCorrelations = {
    workers: new Map(),
    modelTurns: new Map(),
    tools: new Map(),
    commands: new Map(),
  };
  for (const event of events) {
    trackStartedEvent(event, active, ticks);
    closeTerminalEvent(event, active, ticks.activeIds, ticks.failedDrainLanes);
    trackOperatorQuestionLane(event, ticks.activeOperatorQuestionLanes);
  }
}
