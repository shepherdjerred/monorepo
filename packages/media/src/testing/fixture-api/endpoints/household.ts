import {
  CatalogDetailSchema,
  CatalogSearchSchema,
  NotificationListSchema,
  NotificationPreferencesSchema,
  OperationListSchema,
  RemovalListSchema,
  RequestListSchema,
} from "#shared/api.ts";
import { CatalogFeedSchema } from "#shared/catalog/contract.ts";
import { UserSchema } from "#shared/contract.ts";
import {
  CalendarPageSchema,
  RemovalHistoryPageSchema,
} from "#shared/household/calendar.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import {
  NowPlayingSchema,
  PlaybackHistorySchema,
  PlaybackPeopleSchema,
  PlaybackStatisticsSchema,
} from "#shared/household/playback.ts";
import { PlexHistoricalViewsSchema } from "#shared/household/plex-history.ts";
import { RequestInterestProgressSchema } from "#shared/household/progress.ts";
import { MovieEditionRequestListV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { ImportedPersonalClaimsSchema } from "#shared/personal-migration/contract.ts";
import {
  endpoint,
  type FixtureEndpoint,
  type FixtureRequest,
} from "#testing/fixture-api/endpoint.ts";
import { calendarPage } from "#testing/fixture-api/fixtures/calendar.ts";
import {
  catalogDetail,
  catalogDiscover,
  catalogSearch,
} from "#testing/fixture-api/fixtures/catalog.ts";
import { libraryPage } from "#testing/fixture-api/fixtures/library.ts";
import { movieRequestList } from "#testing/fixture-api/fixtures/movies/movie-requests.ts";
import {
  notificationList,
  notificationPreferences,
  operationList,
} from "#testing/fixture-api/fixtures/notifications.ts";
import {
  nowPlaying,
  playbackHistory,
  playbackPeople,
  playbackStatistics,
} from "#testing/fixture-api/fixtures/playback.ts";
import { plexRequestHistory } from "#testing/fixture-api/fixtures/migration/plex-history.ts";
import {
  removalHistory,
  removalList,
} from "#testing/fixture-api/fixtures/removals.ts";
import {
  importedClaims,
  interestList,
  interestProgress,
  requestId,
  requestList,
} from "#testing/fixture-api/fixtures/requests.ts";
import { FEATURED, titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import { KIDS, OWNER } from "#testing/fixture-api/personas.ts";
import { FixtureFailure } from "#testing/fixture-api/scenario.ts";
import { NOW } from "#testing/fixture-api/support.ts";

function subjectOf(request: FixtureRequest): string {
  return request.query.get("subjectUserId") ?? request.user.id;
}

/**
 * A read's usual answer, or `empty` for the household of the `new-household`
 * scenario, which has asked for nothing and holds nothing.
 */
function unlessNewHousehold<Answer>(
  request: FixtureRequest,
  empty: Answer,
  answer: () => Answer,
): Answer {
  return request.scenario === "new-household" ? empty : answer();
}

const NO_ITEMS = { items: [], nextCursor: null };

/** The current month, the range the calendar page opens on. */
const CALENDAR_RANGE = (() => {
  const now = new Date(NOW);
  const month = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `from=${month}-01&to=${month}-28`;
})();

const session: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/me",
    schema: UserSchema,
    respond: (request) => request.user,
    samples: ["/me"],
  }),
];

const catalog: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/catalog/search",
    schema: CatalogSearchSchema,
    respond: (request) => catalogSearch(request.query, request.scenario),
    samples: [
      "/catalog/search?q=the",
      "/catalog/search?q=the&page=2",
      "/catalog/search?q=no-such-title",
    ],
  }),
  endpoint({
    path: "/catalog/discover",
    schema: CatalogSearchSchema,
    respond: (request) => catalogDiscover(request.query, request.scenario),
    samples: [
      ...CatalogFeedSchema.options.map(
        (feed) => `/catalog/discover?feed=${feed}`,
      ),
      "/catalog/discover?feed=trending&page=2",
      "/catalog/discover?feed=on_the_air&page=5",
    ],
  }),
  endpoint({
    path: "/catalog/:kind/:id",
    schema: CatalogDetailSchema,
    respond: (request) =>
      catalogDetail(
        request.param("kind"),
        Number(request.param("id")),
        request.scenario,
      ),
    samples: [
      `/catalog/movie/${String(FEATURED.movie.tmdbId)}`,
      `/catalog/series/${String(FEATURED.series.tmdbId)}`,
      // Titles the household does not have: a series and a film.
      "/catalog/series/1398",
      "/catalog/movie/155",
    ],
  }),
];

const library: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/library",
    schema: LibraryPageSchema,
    respond: (request) => {
      if (request.scenario === "library-unavailable") {
        // What the real server answers when a read throws.
        throw new FixtureFailure(
          500,
          "internal_error",
          "The operation failed; use the request ID for investigation",
        );
      }
      return unlessNewHousehold(request, NO_ITEMS, () =>
        libraryPage(request.query, request.persona),
      );
    },
    samples: [
      "/library?query=&kind=all",
      "/library?query=the&kind=movie",
      "/library?query=&kind=series&limit=50",
      `/library?query=&kind=all&cursor=${encodeURIComponent(JSON.stringify({ title: "Dune", id: titleNamed("Dune").id }))}`,
      "/library?sort=added&limit=12",
      `/library?sort=added&cursor=${encodeURIComponent(JSON.stringify({ addedAt: "2026-01-01T00:00:00.000Z", id: titleNamed("Dune").id }))}`,
      "/library?leaving=soon",
      "/library?mine=following&policy=temporary",
      "/library?availability=unavailable&kind=series",
    ],
  }),
];

const requests: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/requests",
    schema: RequestListSchema,
    respond: (request) =>
      unlessNewHousehold(request, [], () => requestList(request.persona)),
    samples: ["/requests"],
  }),
  endpoint({
    path: "/requests/imported",
    schema: ImportedPersonalClaimsSchema,
    respond: (request) =>
      unlessNewHousehold(request, [], () => importedClaims(request.persona)),
    samples: ["/requests/imported"],
  }),
  endpoint({
    path: "/requests/plex-history",
    schema: PlexHistoricalViewsSchema,
    respond: (request) =>
      unlessNewHousehold(request, NO_ITEMS, () => plexRequestHistory(request)),
    samples: [
      "/requests/plex-history",
      "/requests/plex-history?cursor=view%3A21",
    ],
  }),
  endpoint({
    path: "/request-interests",
    schema: RequestInterestListSchema,
    respond: (request) =>
      unlessNewHousehold(request, NO_ITEMS, () =>
        interestList(request.query, request.persona),
      ),
    samples: [
      "/request-interests",
      `/request-interests?cursor=${requestId(14)}`,
      "/request-interests?include=artwork",
    ],
  }),
  endpoint({
    path: "/request-interests/:id/progress",
    schema: RequestInterestProgressSchema,
    respond: (request) => interestProgress(request.param("id")),
    samples: Array.from(
      { length: 18 },
      (_, index) => `/request-interests/${requestId(index + 1)}/progress`,
    ),
  }),
  endpoint({
    version: 4,
    path: "/movie-requests",
    schema: MovieEditionRequestListV4Schema,
    respond: (request) =>
      unlessNewHousehold(
        request,
        { schemaVersion: 4, subjectUserId: subjectOf(request), ...NO_ITEMS },
        () => movieRequestList(subjectOf(request)),
      ),
    belongsToRequest: (page, request) =>
      page.subjectUserId === subjectOf(request),
    samples: [
      "/movie-requests",
      `/movie-requests?subjectUserId=${OWNER.id}`,
      `/movie-requests?subjectUserId=${KIDS.id}`,
    ],
  }),
];

const calendar: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/calendar",
    schema: CalendarPageSchema,
    respond: (request) => calendarPage(request.query, request.scenario),
    samples: [
      `/calendar?${CALENDAR_RANGE}&kind=all&status=all`,
      `/calendar?${CALENDAR_RANGE}&kind=episode&status=missing`,
      `/calendar?${CALENDAR_RANGE}&kind=digital&status=available`,
    ],
  }),
];

const playback: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/playback/history",
    schema: PlaybackHistorySchema,
    respond: (request) => playbackHistory(request.query, request),
    samples: [
      "/playback/history",
      "/playback/history?search=bear",
      "/playback/history?limit=25",
    ],
  }),
  endpoint({
    path: "/playback/statistics",
    schema: PlaybackStatisticsSchema,
    respond: (request) => playbackStatistics(request.query, request),
    samples: ["/playback/statistics", "/playback/statistics?search=bear"],
  }),
  endpoint({
    path: "/playback/people",
    schema: PlaybackPeopleSchema,
    respond: (request) => playbackPeople(request.persona),
    samples: ["/playback/people"],
  }),
  endpoint({
    path: "/playback/now-playing",
    schema: NowPlayingSchema,
    respond: (request) => nowPlaying(request),
    samples: ["/playback/now-playing"],
  }),
];

const removals: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/removals",
    schema: RemovalListSchema,
    respond: (request) =>
      unlessNewHousehold(request, [], () => removalList(request.persona)),
    samples: ["/removals"],
  }),
  endpoint({
    path: "/removal-history",
    schema: RemovalHistoryPageSchema,
    respond: (request) =>
      unlessNewHousehold(request, NO_ITEMS, () =>
        removalHistory(request.query, request.persona),
      ),
    samples: ["/removal-history"],
  }),
];

const notifications: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/activity",
    schema: OperationListSchema,
    respond: () => operationList(),
    samples: ["/activity"],
  }),
  endpoint({
    path: "/notifications",
    schema: NotificationListSchema,
    respond: (request) => notificationList(request.persona, request.scenario),
    samples: ["/notifications"],
  }),
  endpoint({
    path: "/notifications/preferences",
    schema: NotificationPreferencesSchema,
    respond: (request) => notificationPreferences(request.persona),
    samples: ["/notifications/preferences"],
  }),
];

/** Reads every signed-in household member makes. */
export const HOUSEHOLD_ENDPOINTS: readonly FixtureEndpoint[] = [
  ...session,
  ...catalog,
  ...library,
  ...requests,
  ...calendar,
  ...playback,
  ...removals,
  ...notifications,
];
