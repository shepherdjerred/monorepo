import type { RecordedRunEvent } from "./run-events.ts";

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

function verifyFleetChangeTick(
  event: RecordedRunEvent,
  activeTickIds: Set<string>,
): void {
  if (event.kind !== "fleet.change") {
    return;
  }
  const tickId = event.correlation.tickId;
  if (tickId === undefined || !activeTickIds.has(tickId)) {
    throw new Error(
      `fleet.change references a nonexistent or inactive tick: ${tickId ?? "missing"}`,
    );
  }
}

function trackStartedEvent(
  event: RecordedRunEvent,
  active: ActiveCorrelations,
  activeTickIds: Set<string>,
): void {
  verifyFleetChangeTick(event, activeTickIds);
  if (event.kind === "tick.started") {
    const tickId = event.correlation.tickId;
    if (tickId === undefined) {
      throw new Error("tick.started is missing its tick correlation");
    }
    activeTickIds.add(tickId);
  }
  if (event.kind === "worker.started") {
    const tickId = event.correlation.tickId;
    if (tickId === undefined) {
      throw new Error("worker.started is missing its tick correlation");
    }
    if (!activeTickIds.has(tickId)) {
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
    const tickId = event.correlation.tickId;
    const requiresActiveTick =
      tickId !== undefined && event.correlation.generation === undefined;
    if (requiresActiveTick && !activeTickIds.has(tickId)) {
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
}

function closeTerminalEvent(
  event: RecordedRunEvent,
  active: ActiveCorrelations,
  activeTickIds: Set<string>,
): void {
  if (event.kind === "tick.completed" || event.kind === "tick.failed") {
    const tickId = event.correlation.tickId;
    if (tickId !== undefined) {
      activeTickIds.delete(tickId);
    }
  }
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
  const activeTickIds = new Set<string>();
  const active: ActiveCorrelations = {
    workers: new Map(),
    modelTurns: new Map(),
    tools: new Map(),
    commands: new Map(),
  };
  for (const event of events) {
    trackStartedEvent(event, active, activeTickIds);
    closeTerminalEvent(event, active, activeTickIds);
  }
}
