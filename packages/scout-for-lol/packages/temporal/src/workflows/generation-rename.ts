import {
  proxyActivities,
  type ActivityInterfaceFor,
  type ActivityOptions,
} from "@temporalio/workflow";
import type { ScoutPipelineActivities } from "#src/activities.ts";
import { scoutPreRenameActivityType } from "#src/identifiers.ts";

/**
 * Proxy the pipeline Activities under their renamed surface, scheduling each
 * under the name it was registered with before the rename.
 *
 * Every Activity worker registers both names in this release, but a worker
 * still running the previous image knows only the old ones, so the old name is
 * the one that is safe to issue. The follow-up switches issuance to the new
 * names behind a patch, once every Activity worker registers them; see
 * `SCOUT_RENAMED_WORKFLOW_TYPES`.
 */
export function preRenameActivities<
  Activities extends Partial<ScoutPipelineActivities>,
>(options: ActivityOptions): ActivityInterfaceFor<Activities> {
  const activities = proxyActivities<Activities>(options);
  return new Proxy(activities, {
    get(target, property, receiver) {
      const name =
        typeof property === "string"
          ? scoutPreRenameActivityType(property)
          : property;
      const activity: unknown = Reflect.get(target, name, receiver);
      return activity;
    },
  });
}
