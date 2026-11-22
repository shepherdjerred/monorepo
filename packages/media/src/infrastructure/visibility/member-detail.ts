import type { MediaDetail } from "#shared/api.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { MediaVisibility } from "#shared/visibility/detail.ts";

/**
 * Household members see what happened to their title, not how it was acquired.
 * Every withheld field takes a value its contract already allows, so a browser
 * tab holding an older client keeps parsing the response.
 */
function memberProgress<
  Progress extends Pick<MediaVisibility, "attempts" | "torrents">,
>(progress: Progress): Progress {
  return {
    ...progress,
    attempts: [],
    torrents: progress.torrents.map((torrent) => ({
      ...torrent,
      observedAt: null,
      ratio: null,
      seededSeconds: null,
    })),
  };
}

export function memberDetail(detail: MediaDetail): MediaDetail {
  return {
    ...detail,
    intent:
      detail.intent === null ? null : { ...detail.intent, profileId: null },
    subtitlePolicies: [],
    // The keeping switch is the owner's; `policy` is the household's to read.
    libraryKeeping: null,
    visibility: memberProgress(detail.visibility),
  };
}

/** The same projection for one movie edition's own transfers. */
export function memberMovieTarget(
  context: MovieTargetContextV4,
): MovieTargetContextV4 {
  return context.access !== "detail" || context.progress === null
    ? context
    : { ...context, progress: memberProgress(context.progress) };
}
