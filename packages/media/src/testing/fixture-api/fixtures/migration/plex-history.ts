import type { z } from "zod";
import type { PlexHistoricalViewsSchema } from "#shared/household/plex-history.ts";
import type { FixtureRequest } from "#testing/fixture-api/endpoint.ts";

type HistoryPage = z.input<typeof PlexHistoricalViewsSchema>;

export function plexRequestHistory(request: FixtureRequest): HistoryPage {
  if (request.persona === "member") {
    return {
      items: [
        {
          sourceViewId: 30,
          source: "view",
          kind: "movie",
          title: "The Apartment",
          seriesTitle: null,
          seasonNumber: null,
          episodeNumber: null,
          viewedAt: "2025-09-15T01:23:00.000Z",
        },
      ],
      nextCursor: null,
    };
  }
  if (request.query.get("cursor") === "view:21") {
    return {
      items: [
        {
          sourceViewId: 21,
          source: "last_watched",
          kind: "movie",
          title: "",
          seriesTitle: null,
          seasonNumber: null,
          episodeNumber: null,
          viewedAt: "2018-06-07T20:30:00.000Z",
        },
      ],
      nextCursor: null,
    };
  }
  return {
    items: [
      {
        sourceViewId: 27,
        source: "view",
        kind: "movie",
        title: "Roman Holiday",
        seriesTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        viewedAt: "2025-08-10T23:05:00.000Z",
      },
      {
        sourceViewId: 21,
        source: "view",
        kind: "episode",
        title: "System",
        seriesTitle: "The Bear",
        seasonNumber: 1,
        episodeNumber: 1,
        viewedAt: "2025-07-17T20:43:00.000Z",
      },
    ],
    nextCursor: "view:21",
  };
}
