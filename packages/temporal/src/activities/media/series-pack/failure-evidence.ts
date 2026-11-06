import path from "node:path";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { historyToJSON } from "@temporalio/common/lib/proto-utils.js";

type Event = NonNullable<Parameters<typeof historyToJSON>[0]["events"]>[number];

/** Failure diagnostics contain only durable identities/types, never payloads or private labels. */
export async function seriesPackRoleFailureEvidence(input: {
  environment: TestWorkflowEnvironment;
  workflowIds: readonly string[];
  directory: string;
}) {
  const pending = [...input.workflowIds];
  const histories = [];
  const seen = new Set<string>();
  while (pending.length > 0 && seen.size < 4) {
    const workflowId = pending.shift();
    if (workflowId === undefined || seen.has(workflowId)) continue;
    seen.add(workflowId);
    const history = await input.environment.client.connection.withDeadline(
      Date.now() + 1000,
      () =>
        input.environment.client.workflow.getHandle(workflowId).fetchHistory(),
    );
    const events = (history.events ?? []).map((event) => {
      const child =
        event.childWorkflowExecutionStartedEventAttributes?.workflowExecution
          ?.workflowId;
      if (child != null) pending.push(child);
      return eventSummary(event);
    });
    histories.push({ workflowId, events: events.slice(-40) });
  }
  const logs = [];
  for (const name of ["workflow.log", "workflow-errors.log"]) {
    const file = Bun.file(path.join(input.directory, name));
    if (!(await file.exists())) continue;
    const text = await file.slice(0, 262_144).text();
    logs.push({
      name,
      bytes: file.size,
      errorTypes: [...new Set(text.match(/\b[A-Za-z]+(?:Error|Failure)\b/gu))],
      missingIdentifiers: [
        ...text.matchAll(/\b(?<name>[A-Za-z_$][\w$]*) is not defined/gu),
      ].map((match) => match.groups?.["name"]),
      missingProperties: [
        ...text.matchAll(
          /Cannot read properties of (?:undefined|null) \(reading '(?<name>[A-Za-z_$][\w$]*)'\)/gu,
        ),
      ].map((match) => match.groups?.["name"]),
      workflowTaskFailed:
        /Failed to activate workflow|WorkflowTask failed/u.test(text),
    });
  }
  return { histories, logs };
}

function eventSummary(event: Event) {
  const child = event.startChildWorkflowExecutionInitiatedEventAttributes;
  const scheduled = event.activityTaskScheduledEventAttributes;
  return {
    id: event.eventId?.toString(),
    type: event.eventType,
    activityId: scheduled?.activityId,
    activityType: scheduled?.activityType?.name,
    childWorkflowId: child?.workflowId,
    childWorkflowType: child?.workflowType?.name,
    ...eventSettlement(event),
  };
}

function eventSettlement(event: Event) {
  return {
    scheduledEventId: (
      event.activityTaskStartedEventAttributes?.scheduledEventId ??
      event.activityTaskCompletedEventAttributes?.scheduledEventId ??
      event.activityTaskFailedEventAttributes?.scheduledEventId
    )?.toString(),
    activityFailureType:
      event.activityTaskFailedEventAttributes?.failure?.applicationFailureInfo
        ?.type,
    workflowTaskFailureCause: event.workflowTaskFailedEventAttributes?.cause,
    workflowTaskFailureType:
      event.workflowTaskFailedEventAttributes?.failure?.applicationFailureInfo
        ?.type,
  };
}
