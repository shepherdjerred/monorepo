import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  PlexBindingExecution,
  ReverifyPlexBindingInput,
} from "#shared/plex-binding/activities.ts";
import { reverifyPlexBinding } from "./reverify.ts";

/** Cached credentials/context only; the caller supplies each Activity's execution. */
export function createPlexBindingActivities(context: MediaAutomationContext) {
  return {
    reverify: (
      input: ReverifyPlexBindingInput,
      execution: PlexBindingExecution,
    ) => reverifyPlexBinding(context, input, execution),
  };
}
