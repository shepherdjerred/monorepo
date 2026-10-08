import {
  inWorkflowContext,
  makeContinueAsNewFunc,
  patched,
  proxyActivities,
  type ActivityInterfaceFor,
  type ActivityOptions,
  type Workflow,
} from "@temporalio/workflow";
import type { ScoutPipelineActivities } from "#src/activities.ts";
import {
  SCOUT_GENERATION_RENAME_PATCH,
  SCOUT_PRE_RENAME_WORKFLOW_TYPES,
  scoutPreRenameActivityType,
  type ScoutRenamedWorkflowName,
} from "#src/identifiers.ts";

/**
 * Whether this history issues the renamed Workflow and Activity types.
 *
 * A history recorded before the rename answers `false` while it replays the
 * commands it already recorded, so each one is reissued under the name it was
 * recorded with; it answers `true` from its first new command on, and so does
 * every history started after the rename. See
 * `SCOUT_GENERATION_RENAME_PATCH` for why the names cannot simply change.
 */
function usesRenamedTypes(): boolean {
  return patched(SCOUT_GENERATION_RENAME_PATCH);
}

/** The Workflow type to start a renamed child under, in this history. */
export function renamedChildWorkflowType(
  workflowType: ScoutRenamedWorkflowName,
): string {
  return usesRenamedTypes()
    ? workflowType
    : SCOUT_PRE_RENAME_WORKFLOW_TYPES[workflowType];
}

/**
 * Continue a renamed Workflow as new under its renamed type.
 *
 * Continue-as-new keeps the CURRENT type by default, so an execution started
 * under the pre-rename type would carry it into every run it continues into
 * and stop the moment the alias is removed. Naming the type moves it onto the
 * renamed one at its next continue-as-new. Replay does not check the type a
 * continue-as-new names, so this needs no patch.
 */
export function continueAsRenamed<F extends Workflow>(
  workflowType: ScoutRenamedWorkflowName,
): (...args: Parameters<F>) => Promise<never> {
  return makeContinueAsNewFunc<F>({ workflowType });
}

/**
 * Proxy the pipeline Activities, scheduling each under the name this history
 * is entitled to.
 *
 * The caller sees the renamed surface; only the Activity type on the wire
 * changes, and only for a history recorded before the rename. Outside a
 * Workflow — a unit test inspecting the surface — nothing is scheduled, so the
 * plain proxy answers.
 */
export function renameBridgedActivities<
  Activities extends Partial<ScoutPipelineActivities>,
>(options: ActivityOptions): ActivityInterfaceFor<Activities> {
  const activities = proxyActivities<Activities>(options);
  return new Proxy(activities, {
    get(target, property, receiver) {
      if (
        typeof property !== "string" ||
        !inWorkflowContext() ||
        scoutPreRenameActivityType(property) === property ||
        usesRenamedTypes()
      ) {
        const current: unknown = Reflect.get(target, property, receiver);
        return current;
      }
      const preRename: unknown = Reflect.get(
        target,
        scoutPreRenameActivityType(property),
        receiver,
      );
      return preRename;
    },
  });
}
