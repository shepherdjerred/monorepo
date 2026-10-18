import {
  deprecatePatch,
  makeContinueAsNewFunc,
  proxyActivities,
  type ActivityInterfaceFor,
  type ActivityOptions,
  type Workflow,
} from "@temporalio/workflow";
import type { ScoutPipelineActivities } from "#src/activities.ts";
import {
  scoutPreRenameActivityType,
  type ScoutRenamedWorkflowName,
} from "#src/identifiers.ts";

/**
 * The retired replay gate for issuing the renamed Workflow and Activity types
 * from inside a Workflow.
 *
 * Every retained history recorded it, so nothing replays the pre-rename
 * branch any more and the renamed types are issued unconditionally.
 * `deprecatePatch` still records the marker at each point the gate stood, so
 * a rollback to a bundle that gates on it replays histories this bundle
 * records instead of issuing the pre-rename types no worker accepts. Remove
 * the `deprecatePatch` calls in a release after this one.
 */
export const SCOUT_GENERATION_RENAME_PATCH = "scout-generation-rename";

/** The Workflow type a child start or a Continue-As-New issues. */
export function issuedWorkflowType(
  name: ScoutRenamedWorkflowName,
): ScoutRenamedWorkflowName {
  deprecatePatch(SCOUT_GENERATION_RENAME_PATCH);
  return name;
}

/**
 * Continue as new under the renamed Workflow type, naming it explicitly as the
 * retired gate did.
 */
export async function continueAsNewAsRenamed<F extends Workflow>(
  name: ScoutRenamedWorkflowName,
  ...args: Parameters<F>
): Promise<never> {
  return await makeContinueAsNewFunc<F>({
    workflowType: issuedWorkflowType(name),
  })(...args);
}

/**
 * Proxy the pipeline Activities under their renamed surface.
 *
 * The retired gate was consulted when a renamed Activity was called, which is
 * when it is scheduled, so the deprecated marker is recorded at that same
 * command; an Activity whose name never changed records none.
 */
export function renamedPipelineActivities<
  Activities extends Partial<ScoutPipelineActivities>,
>(options: ActivityOptions): ActivityInterfaceFor<Activities> {
  const activities = proxyActivities<Activities>(options);
  return new Proxy(activities, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      }
      return (...args: unknown[]): unknown => {
        const activity: unknown = Reflect.get(target, property, receiver);
        if (typeof activity !== "function") {
          throw new TypeError(`No Activity proxy for ${property}`);
        }
        if (scoutPreRenameActivityType(property) !== property) {
          deprecatePatch(SCOUT_GENERATION_RENAME_PATCH);
        }
        const scheduled: unknown = Reflect.apply(activity, undefined, args);
        return scheduled;
      };
    },
  });
}
