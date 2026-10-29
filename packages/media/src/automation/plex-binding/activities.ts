import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  PlexBindingExecution,
  ReverifyPlexBindingInput,
  LibraryPlexBindingInputV1,
} from "#shared/plex-binding/activities.ts";
import { reverifyPlexBinding } from "./reverify.ts";
import { verifyLibraryPlexBinding } from "./library.ts";

/** Cached credentials/context only; the caller supplies each Activity's execution. */
export function createPlexBindingActivities(context: MediaAutomationContext) {
  return {
    verifyLibrary: (
      input: LibraryPlexBindingInputV1,
      execution: PlexBindingExecution,
    ) => verifyLibraryPlexBinding(context, input, execution),
    reverify: (
      input: ReverifyPlexBindingInput,
      execution: PlexBindingExecution,
    ) => reverifyPlexBinding(context, input, execution),
  };
}
