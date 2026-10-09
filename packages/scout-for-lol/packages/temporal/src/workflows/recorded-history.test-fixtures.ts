import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import type { WorkflowHandle } from "@temporalio/client";
import {
  SCOUT_PRE_RENAME_WORKFLOW_TYPES,
  type ScoutRenamedWorkflowName,
} from "#src/identifiers.ts";

type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;

/**
 * A committed history fixture, recorded under the pre-rename Workflow type it
 * ran as, read as the same run started under its renamed type.
 *
 * Every committed fixture predates the generation rename, and this bundle no
 * longer registers the pre-rename types, so replaying one as recorded fails
 * before its first command. Only the started event names a Workflow's own
 * type, and the bundles that recorded these ran one function under both
 * names, so the rest of the history — including the pre-rename Activity and
 * child types it scheduled — is exactly what that run would have recorded.
 *
 * Retained histories under the pre-rename types do not get this treatment in
 * production: against this bundle they no longer replay at all.
 */
export function recordedUnderRenamedType(
  recorded: unknown,
  workflowType: ScoutRenamedWorkflowName,
): History {
  const history = historyFromJSON(structuredClone(recorded));
  const started = history.events?.[0]?.workflowExecutionStartedEventAttributes;
  if (started?.workflowType === undefined || started.workflowType === null) {
    throw new Error("A recorded history starts with its started event");
  }
  const preRename = SCOUT_PRE_RENAME_WORKFLOW_TYPES[workflowType];
  if (started.workflowType.name !== preRename) {
    throw new Error(
      `Expected a history recorded under ${preRename}, got ${String(started.workflowType.name)}`,
    );
  }
  started.workflowType.name = workflowType;
  return history;
}
