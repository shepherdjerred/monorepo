import { memberDetail } from "#infrastructure/visibility/member-detail.ts";
import { MediaDetailSchema, ReleaseListSchema } from "#shared/api.ts";
import {
  DEFAULT_TARGET_BATCH_LIMIT,
  DefaultTargetBatchIdsSchema,
  DefaultTargetBatchSchema,
  batchAnswers,
} from "#shared/editions/target-batch.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { MovieHistoryPendingV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";
import {
  MovieEditionContextV4Schema,
  MovieTargetContextV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieRollbackViewV1Schema } from "#shared/movie-editions/rollback/view.ts";
import { MovieSubtitleTargetV2Schema } from "#shared/movie-editions/subtitle-target-v2.ts";
import {
  endpoint,
  type FixtureEndpoint,
  type FixtureRequest,
} from "#testing/fixture-api/endpoint.ts";
import {
  defaultTarget,
  defaultTargetBatch,
  mediaDetail,
} from "#testing/fixture-api/fixtures/media-detail.ts";
import {
  EDITIONS,
  movieEditionContext,
} from "#testing/fixture-api/fixtures/movie-requests.ts";
import {
  movieRollback,
  movieSubtitleTarget,
  movieTarget,
} from "#testing/fixture-api/fixtures/movie-targets.ts";
import { movieHistoryReviews } from "#testing/fixture-api/fixtures/owner.ts";
import { releaseList } from "#testing/fixture-api/fixtures/releases.ts";
import {
  AIRING_EPISODES,
  FEATURED,
  TITLES,
  episodeId,
  resolveMedia,
  resolveMovie,
  seasonId,
  titleNamed,
} from "#testing/fixture-api/fixtures/titles.ts";
import { OWNER } from "#testing/fixture-api/personas.ts";

function editionOf(request: FixtureRequest) {
  const parsed = MovieEditionKeySchema.safeParse(request.param("edition"));
  return parsed.success ? parsed.data : null;
}

function subjectOf(request: FixtureRequest): string {
  return request.query.get("subjectUserId") ?? request.user.id;
}

/** A rejected `ids` query is the caller's error: the router answers it 400. */
function batchIds(request: FixtureRequest): string[] {
  return DefaultTargetBatchIdsSchema.parse(request.query.get("ids"));
}

const MOVIES = TITLES.filter((title) => title.kind === "movie");
/** Shaped like a title's id; no fixture title has it. */
const UNKNOWN_MEDIA_ID = "00000002-0000-4000-8000-00000000ffff";

/** Every title, plus seasons and episodes in each state a page can show. */
const MEDIA_IDS: readonly string[] = [
  ...TITLES.map((title) => title.id),
  seasonId(FEATURED.series, 1),
  seasonId(FEATURED.series, 2),
  seasonId(titleNamed("The Bear"), 4),
  episodeId(FEATURED.series, 1, 3),
  ...AIRING_EPISODES.map((airing) =>
    episodeId(airing.title, airing.season, airing.episode),
  ),
];
const MOVIE_EDITION_PATHS: readonly string[] = MOVIES.flatMap((movie) =>
  EDITIONS.map((edition) => `/media/${movie.id}/movie-editions/${edition}`),
);

/** The title page and every secondary read it makes. */
export const MEDIA_ENDPOINTS: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/media/:id",
    schema: MediaDetailSchema,
    respond: (request) => {
      const resolved = resolveMedia(request.param("id"));
      if (resolved === null) {
        return null;
      }
      const detail = mediaDetail(resolved, request.persona);
      // Anyone but the owner reads the server's own member projection.
      return request.persona === "owner"
        ? detail
        : memberDetail(MediaDetailSchema.parse(detail));
    },
    samples: MEDIA_IDS.map((id) => `/media/${id}`),
  }),
  endpoint({
    path: "/media/:id/releases",
    schema: ReleaseListSchema,
    respond: (request) => {
      const resolved = resolveMedia(request.param("id"));
      if (resolved === null) {
        return null;
      }
      // Release candidates are owner data; a member's read succeeds, empty.
      return request.persona === "owner" ? releaseList(resolved) : [];
    },
    samples: MEDIA_IDS.map((id) => `/media/${id}/releases`),
  }),
  endpoint({
    version: 2,
    path: "/media/:id/targets/default",
    schema: DefaultTargetViewSchema,
    respond: (request) => {
      const resolved = resolveMedia(request.param("id"));
      return resolved === null
        ? null
        : defaultTarget(resolved, request.persona);
    },
    samples: MEDIA_IDS.map((id) => `/media/${id}/targets/default`),
  }),
  endpoint({
    version: 2,
    path: "/targets/default",
    schema: DefaultTargetBatchSchema,
    respond: (request) =>
      defaultTargetBatch(batchIds(request), request.persona),
    belongsToRequest: (batch, request) =>
      batchAnswers(batch, batchIds(request)),
    samples: [
      `/targets/default?ids=${MEDIA_IDS.slice(0, DEFAULT_TARGET_BATCH_LIMIT).join(",")}`,
      `/targets/default?ids=${MEDIA_IDS.slice(DEFAULT_TARGET_BATCH_LIMIT).join(",")}`,
      // A repeated title and one the library does not hold.
      `/targets/default?ids=${[FEATURED.movie.id, UNKNOWN_MEDIA_ID, FEATURED.movie.id].join(",")}`,
    ],
  }),
  endpoint({
    version: 4,
    path: "/media/:id/movie-edition-context",
    schema: MovieEditionContextV4Schema,
    respond: (request) => {
      const resolved = resolveMovie(request.param("id"));
      return resolved === null
        ? null
        : movieEditionContext(resolved.title, subjectOf(request));
    },
    belongsToRequest: (context, request) =>
      context.mediaId === request.param("id") &&
      context.subjectUserId === subjectOf(request),
    samples: MOVIES.map(
      (movie) =>
        `/media/${movie.id}/movie-edition-context?subjectUserId=${OWNER.id}`,
    ),
  }),
  endpoint({
    version: 4,
    path: "/media/:id/movie-editions/:edition",
    schema: MovieTargetContextV4Schema,
    respond: (request) => {
      const resolved = resolveMovie(request.param("id"));
      const edition = editionOf(request);
      return resolved === null || edition === null
        ? null
        : movieTarget(resolved, edition, request.persona);
    },
    belongsToRequest: (context, request) =>
      context.scope.mediaId === request.param("id") &&
      context.scope.edition === request.param("edition"),
    samples: MOVIE_EDITION_PATHS,
  }),
  endpoint({
    version: 4,
    path: "/media/:id/movie-editions/:edition/rollback",
    access: "owner",
    schema: MovieRollbackViewV1Schema,
    respond: (request) => {
      const resolved = resolveMovie(request.param("id"));
      const edition = editionOf(request);
      return resolved === null || edition === null
        ? null
        : movieRollback(resolved, edition);
    },
    belongsToRequest: (view, request) =>
      view.scope.rootMediaId === request.param("id") &&
      view.scope.mediaId === request.param("id") &&
      view.scope.edition === request.param("edition"),
    samples: MOVIE_EDITION_PATHS.map((path) => `${path}/rollback`),
  }),
  endpoint({
    version: 2,
    path: "/media/:id/movie-editions/:edition/subtitle-target",
    access: "owner",
    schema: MovieSubtitleTargetV2Schema,
    respond: (request) => {
      const resolved = resolveMovie(request.param("id"));
      const edition = editionOf(request);
      return resolved === null || edition === null
        ? null
        : movieSubtitleTarget(resolved, edition);
    },
    belongsToRequest: (target, request) =>
      target.scope.mediaId === request.param("id") &&
      target.scope.edition === request.param("edition"),
    samples: MOVIE_EDITION_PATHS.map((path) => `${path}/subtitle-target`),
  }),
  endpoint({
    version: 3,
    path: "/movie-history/reviews",
    schema: MovieHistoryPendingV3Schema,
    respond: (request) => movieHistoryReviews(request.query),
    belongsToRequest: (pending, request) => {
      const mediaId = request.query.get("mediaId");
      return (
        mediaId === null ||
        pending.reviews.every(
          (review) =>
            review.scope.mediaId === mediaId &&
            review.scope.rootMediaId === mediaId &&
            review.scope.edition === request.query.get("edition"),
        )
      );
    },
    samples: [
      "/movie-history/reviews",
      `/movie-history/reviews?mediaId=${titleNamed("Blade Runner").id}&edition=final_cut`,
      `/movie-history/reviews?mediaId=${FEATURED.movie.id}&edition=default`,
    ],
  }),
];
