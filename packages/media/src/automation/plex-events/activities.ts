import type { MediaAutomationContext } from "#automation/context.ts";
import {
  ObservePlexHintInputSchema,
  type PlexEventActivities,
} from "#shared/plex-events/contract.ts";
import { watchCheckpoint } from "./execution.ts";
import { observeWatchBatch } from "./observe.ts";

export function createPlexEventActivities(
  context: MediaAutomationContext,
  enabled: () => Promise<boolean>,
): PlexEventActivities {
  return {
    async observePlexEventHint(raw) {
      const execution = context.plexBindingExecution();
      await watchCheckpoint(execution);
      const allowed = await enabled();
      await watchCheckpoint(execution);
      if (!allowed) return { status: "disabled", complete: false };
      const input = ObservePlexHintInputSchema.parse(raw);
      const result = await observeWatchBatch(
        context,
        input.mediaId,
        { expectedHint: input },
        execution,
      );
      return { status: result.status, complete: result.complete };
    },
  };
}
