import { MediaError } from "#application/errors.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type {
  MediaAttemptOperation,
  MediaFileActivities,
} from "#shared/automation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { prepareSeriesPackPublicationV1 } from "./publication.ts";

/** Both original capabilities are supplied before lazy loading; neither enters the Activity payload. */
export function createSeriesPackPublicationFileFacet(context: FileContext) {
  return async (
    input: MediaAttemptOperation,
    execution: PublicationExecution,
    budget: PublicationAuthorityReadBudget,
  ): ReturnType<MediaFileActivities["prepareSeriesPackPublication"]> => {
    execution.assertActive();
    execution.signal.throwIfAborted();
    try {
      await prepareSeriesPackPublicationV1(
        { ...context, publicationExecution: () => execution },
        input,
        budget,
      );
      return { status: "prepared" };
    } catch (error) {
      if (error instanceof FileGuardError)
        return {
          status: error.reason.includes("obsolete") ? "obsolete" : "blocked",
          reason: error.reason,
        };
      if (error instanceof PlexBindingProtection)
        return { status: "blocked", reason: error.reason };
      if (error instanceof MediaError)
        return { status: "blocked", reason: error.code };
      throw error;
    }
  };
}
