import type { MediaAutomationContext } from "#automation/context.ts";
import {
  ObserveMoviePlexHintV4Schema,
  type ObserveMoviePlexHintV4,
} from "#shared/plex-events/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { watchCheckpoint } from "./execution.ts";
import { observeWatchBatch } from "./observe.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";

/** Hints identify a binding; only a fresh authenticated requester read supplies watch state. */
export function createMovieWatchFacetV4(
  context: MediaAutomationContext,
  enabled: () => Promise<boolean>,
) {
  return {
    async observeMoviePlexHintV4(
      raw: ObserveMoviePlexHintV4,
      execution: PlexBindingExecution,
    ) {
      const invocation = movieManagementContext({
        ...context,
        plexBindingExecution: () => execution,
      });
      await watchCheckpoint(execution);
      const allowed = await enabled();
      await watchCheckpoint(execution);
      if (!allowed) return { status: "disabled" as const, complete: false };
      const input = ObserveMoviePlexHintV4Schema.parse(raw);
      const result = await observeWatchBatch(
        invocation,
        input.mediaId,
        { expectedHint: input, edition: input.scope.edition },
        execution,
      );
      return { status: result.status, complete: result.complete };
    },
  };
}
