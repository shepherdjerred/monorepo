import type { MediaDetail } from "#shared/api.ts";

/**
 * Household members see what happened to their title, not how it was acquired.
 * Every withheld field takes a value its contract already allows, so a browser
 * tab holding an older client keeps parsing the response.
 */
export function memberDetail(detail: MediaDetail): MediaDetail {
  return {
    ...detail,
    intent:
      detail.intent === null ? null : { ...detail.intent, profileId: null },
    subtitlePolicies: [],
    visibility: {
      ...detail.visibility,
      attempts: [],
      torrents: detail.visibility.torrents.map((torrent) => ({
        ...torrent,
        observedAt: null,
        ratio: null,
        seededSeconds: null,
      })),
    },
  };
}
