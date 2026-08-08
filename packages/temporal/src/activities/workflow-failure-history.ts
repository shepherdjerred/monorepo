import { z } from "zod/v4";

export type WorkflowTimeoutClassification =
  | "workflow-task"
  | "activity"
  | "execution"
  | "unknown";

export type WorkflowTimeoutHistoryClassification = {
  classification: WorkflowTimeoutClassification;
  workflowTaskScheduled: boolean;
  workflowTaskStarted: boolean;
  workflowTaskScheduledButNotStarted: boolean;
  activityScheduled: boolean;
  activityStarted: boolean;
  activityScheduledButNotStarted: boolean;
  activityScheduleToStartTimedOut: boolean;
};

const ProtobufLongSchema = z.object({
  low: z.number().int(),
  high: z.number().int(),
  unsigned: z.boolean(),
});

function eventRecord(event: unknown): Record<string, unknown> | undefined {
  if (typeof event !== "object" || event === null) {
    return undefined;
  }
  return z.record(z.string(), z.unknown()).parse(event);
}

function eventId(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }

  // Temporal's protobuf history uses Long objects for event IDs. Convert the
  // stable two-word representation so this does not depend on Long's runtime
  // implementation or its prototype methods.
  const parsed = ProtobufLongSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const { low, high, unsigned } = parsed.data;
  const magnitude = (BigInt(high >>> 0) << 32n) + BigInt(low >>> 0);
  return (
    unsigned || high >= 0 ? magnitude : magnitude - (1n << 64n)
  ).toString();
}

function scheduledEventId(event: unknown): string | undefined {
  const record = eventRecord(event);
  return record === undefined
    ? undefined
    : eventId(record["eventId"] ?? record["event_id"]);
}

function startedActivityScheduledEventId(event: unknown): string | undefined {
  const record = eventRecord(event);
  if (record === undefined) {
    return undefined;
  }
  const attributes =
    record["activityTaskStartedEventAttributes"] ??
    record["activity_task_started_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  return attributesRecord === undefined
    ? undefined
    : eventId(
        attributesRecord["scheduledEventId"] ??
          attributesRecord["scheduled_event_id"],
      );
}

function startedWorkflowTaskScheduledEventId(
  event: unknown,
): string | undefined {
  const record = eventRecord(event);
  if (record === undefined) {
    return undefined;
  }
  const attributes =
    record["workflowTaskStartedEventAttributes"] ??
    record["workflow_task_started_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  return attributesRecord === undefined
    ? undefined
    : eventId(
        attributesRecord["scheduledEventId"] ??
          attributesRecord["scheduled_event_id"],
      );
}

function timedOutWorkflowTaskScheduledEventId(
  event: unknown,
): string | undefined {
  const record = eventRecord(event);
  if (record === undefined) {
    return undefined;
  }
  const attributes =
    record["workflowTaskTimedOutEventAttributes"] ??
    record["workflow_task_timed_out_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  return attributesRecord === undefined
    ? undefined
    : eventId(
        attributesRecord["scheduledEventId"] ??
          attributesRecord["scheduled_event_id"],
      );
}

function activityTaskScheduledActivityId(event: unknown): string | undefined {
  const record = eventRecord(event);
  if (record === undefined) {
    return undefined;
  }
  const attributes =
    record["activityTaskScheduledEventAttributes"] ??
    record["activity_task_scheduled_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  const value =
    attributesRecord?.["activityId"] ?? attributesRecord?.["activity_id"];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function timedOutActivityTaskScheduledEventId(
  event: unknown,
): string | undefined {
  const record = eventRecord(event);
  if (record === undefined) {
    return undefined;
  }
  const attributes =
    record["activityTaskTimedOutEventAttributes"] ??
    record["activity_task_timed_out_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  return attributesRecord === undefined
    ? undefined
    : eventId(
        attributesRecord["scheduledEventId"] ??
          attributesRecord["scheduled_event_id"],
      );
}

function isScheduleToStartTimeout(value: unknown): boolean {
  if (typeof value === "string") {
    return value.toUpperCase().includes("SCHEDULE_TO_START");
  }
  return value === 2;
}

function activityTaskTimedOutAsScheduleToStart(event: unknown): boolean {
  const record = eventRecord(event);
  if (record === undefined) {
    return false;
  }
  const attributes =
    record["activityTaskTimedOutEventAttributes"] ??
    record["activity_task_timed_out_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  return (
    attributesRecord !== undefined &&
    isScheduleToStartTimeout(
      attributesRecord["timeoutType"] ?? attributesRecord["timeout_type"],
    )
  );
}

function markRecoveredActivitySchedules(
  activityId: string,
  timedOutScheduleIds: ReadonlySet<string>,
  activityIdsByScheduleId: ReadonlyMap<string, string>,
  recoveredScheduleIds: Set<string>,
): void {
  for (const timedOutId of timedOutScheduleIds) {
    if (activityIdsByScheduleId.get(timedOutId) === activityId) {
      recoveredScheduleIds.add(timedOutId);
    }
  }
}

function historyEvents(history: unknown): readonly unknown[] {
  if (Array.isArray(history)) {
    return history;
  }
  if (typeof history !== "object" || history === null) {
    return [];
  }
  const record = z.record(z.string(), z.unknown()).parse(history);
  const events = record["events"];
  return Array.isArray(events) ? events : [];
}

function eventTypeName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  }
  if (typeof value !== "number") {
    return undefined;
  }
  // These are the stable Temporal HistoryEvent enum values used by
  // @temporalio/client's fetchHistory() protobuf objects.
  switch (value) {
    case 4:
      return "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT";
    case 5:
      return "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED";
    case 6:
      return "EVENT_TYPE_WORKFLOW_TASK_STARTED";
    case 8:
      return "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT";
    case 10:
      return "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED";
    case 11:
      return "EVENT_TYPE_ACTIVITY_TASK_STARTED";
    case 14:
      return "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT";
    default:
      return undefined;
  }
}

function eventType(event: unknown): unknown {
  const record = eventRecord(event);
  return record?.["eventType"] ?? record?.["event_type"];
}

export function classifyWorkflowTimeoutHistory(
  history: unknown,
): WorkflowTimeoutHistoryClassification {
  let workflowTaskScheduled = false;
  let workflowTaskStarted = false;
  let activityScheduled = false;
  let activityStarted = false;
  let activityScheduleToStartTimedOut = false;
  const scheduledWorkflowTaskEventIds = new Set<string>();
  const handledWorkflowTaskScheduledEventIds = new Set<string>();
  const scheduledActivityEventIds = new Set<string>();
  const startedActivityScheduledEventIds = new Set<string>();
  const activityIdByScheduledEventId = new Map<string, string>();
  const timedOutActivityScheduledEventIds = new Set<string>();
  const recoveredActivityScheduledEventIds = new Set<string>();
  let latestTimeout: WorkflowTimeoutClassification | undefined;

  for (const event of historyEvents(history)) {
    const name = eventTypeName(eventType(event));
    if (name === undefined) {
      continue;
    }
    if (name === "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED") {
      workflowTaskScheduled = true;
      const id = scheduledEventId(event);
      if (id !== undefined) {
        scheduledWorkflowTaskEventIds.add(id);
      }
    }
    if (name === "EVENT_TYPE_WORKFLOW_TASK_STARTED") {
      workflowTaskStarted = true;
      const scheduledId = startedWorkflowTaskScheduledEventId(event);
      if (scheduledId !== undefined) {
        handledWorkflowTaskScheduledEventIds.add(scheduledId);
      }
    }
    if (name === "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED") {
      activityScheduled = true;
      const id = scheduledEventId(event);
      if (id !== undefined) {
        scheduledActivityEventIds.add(id);
        const activityId = activityTaskScheduledActivityId(event);
        if (activityId !== undefined) {
          markRecoveredActivitySchedules(
            activityId,
            timedOutActivityScheduledEventIds,
            activityIdByScheduledEventId,
            recoveredActivityScheduledEventIds,
          );
          activityIdByScheduledEventId.set(id, activityId);
        }
      }
    }
    if (name === "EVENT_TYPE_ACTIVITY_TASK_STARTED") {
      activityStarted = true;
      const scheduledId = startedActivityScheduledEventId(event);
      if (scheduledId !== undefined) {
        startedActivityScheduledEventIds.add(scheduledId);
      }
    }
    switch (name) {
      case "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT":
        {
          const scheduledId = timedOutWorkflowTaskScheduledEventId(event);
          if (scheduledId !== undefined) {
            handledWorkflowTaskScheduledEventIds.add(scheduledId);
          }
        }
        latestTimeout = "workflow-task";
        break;
      case "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT":
        {
          const scheduledId = timedOutActivityTaskScheduledEventId(event);
          if (scheduledId !== undefined) {
            timedOutActivityScheduledEventIds.add(scheduledId);
          }
          activityScheduleToStartTimedOut =
            activityScheduleToStartTimedOut ||
            activityTaskTimedOutAsScheduleToStart(event);
        }
        latestTimeout = "activity";
        break;
      case "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT":
        latestTimeout = "execution";
        break;
    }
  }

  return {
    classification: latestTimeout ?? "unknown",
    workflowTaskScheduled,
    workflowTaskStarted,
    workflowTaskScheduledButNotStarted: [...scheduledWorkflowTaskEventIds].some(
      (id) => !handledWorkflowTaskScheduledEventIds.has(id),
    ),
    activityScheduled,
    activityStarted,
    activityScheduledButNotStarted: [...scheduledActivityEventIds].some(
      (id) =>
        !startedActivityScheduledEventIds.has(id) &&
        !timedOutActivityScheduledEventIds.has(id) &&
        !recoveredActivityScheduledEventIds.has(id),
    ),
    activityScheduleToStartTimedOut,
  };
}
