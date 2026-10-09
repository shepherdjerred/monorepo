import {
  makeContinueAsNewFunc,
  patched,
  proxyActivities,
  type ActivityInterfaceFor,
  type ActivityOptions,
  type Workflow,
} from "@temporalio/workflow";
import type { ScoutPipelineActivities } from "#src/activities.ts";
import {
  SCOUT_PRE_RENAME_WORKFLOW_TYPES,
  scoutPreRenameActivityType,
  type ScoutRenamedWorkflowName,
} from "#src/identifiers.ts";

/**
 * Replay gate for issuing the renamed Workflow and Activity types from inside a
 * Workflow.
 *
 * sdk-core checks every replayed command against the history by type: an
 * Activity scheduled, or a child started, under a different name from the one
 * recorded is a nondeterminism error. A history recorded before this patch
 * named the pre-rename types, so replaying it without a marker keeps issuing
 * them. Everything recorded with this patch, including an open execution that
 * reaches its first live Workflow Task after the deploy, issues the renamed
 * types from then on, and a long-lived Workflow continues as new under its
 * renamed type. Retire with `deprecatePatch` once no execution predating it
 * can still replay.
 */
export const SCOUT_GENERATION_RENAME_PATCH = "scout-generation-rename";

/**
 * The Workflow type a child start or a Continue-As-New issues: the renamed
 * type, or the pre-rename one for a history recorded before the patch.
 */
export function issuedWorkflowType(name: ScoutRenamedWorkflowName): string {
  return patched(SCOUT_GENERATION_RENAME_PATCH)
    ? name
    : SCOUT_PRE_RENAME_WORKFLOW_TYPES[name];
}

/**
 * Continue as new under the renamed Workflow type.
 *
 * A plain `continueAsNew` keeps the current run's type, so an execution
 * started under its pre-rename type would carry that type into every later
 * run. Naming the type here is what moves the long-lived Workflows — the
 * client-match dispatcher singleton above all — onto the renamed type, which
 * is what lets the aliases go.
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
 * Proxy the pipeline Activities under their renamed surface, scheduling each
 * under the name the Workflow's history calls for.
 *
 * The patch is consulted when an Activity is called, which is when it is
 * scheduled, rather than when it is looked up, so a proxy destructured early
 * still decides at the command it gates; and only for an Activity whose name
 * changed, so an unrenamed one never needs a marker. Every Activity worker
 * registers both names (`withPreRenameActivityNames`), so either is safe to
 * issue.
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
        const activity: unknown = Reflect.get(
          target,
          issuedActivityType(property),
          receiver,
        );
        if (typeof activity !== "function") {
          throw new TypeError(`No Activity proxy for ${property}`);
        }
        const scheduled: unknown = Reflect.apply(activity, undefined, args);
        return scheduled;
      };
    },
  });
}

function issuedActivityType(name: string): string {
  const preRename = scoutPreRenameActivityType(name);
  if (preRename === name) return name;
  return patched(SCOUT_GENERATION_RENAME_PATCH) ? name : preRename;
}
