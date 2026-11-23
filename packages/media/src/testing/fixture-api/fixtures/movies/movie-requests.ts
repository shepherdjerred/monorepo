import type { z } from "zod";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import type {
  MovieEditionContextV4Schema,
  MovieEditionRequestListV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
  type MovieEditionKey,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { KIDS } from "#testing/fixture-api/personas.ts";
import { requestId } from "#testing/fixture-api/fixtures/requests.ts";
import { fixtureId, sha256, versionOf } from "#testing/fixture-api/support.ts";
import {
  titleNamed,
  type Title,
} from "#testing/fixture-api/fixtures/titles.ts";

type MovieRequestList = z.input<typeof MovieEditionRequestListV4Schema>;
type MovieEditionContext = z.input<typeof MovieEditionContextV4Schema>;

export const EDITIONS: readonly MovieEditionKey[] =
  MovieEditionKeySchema.options;

export function editionLabel(edition: MovieEditionKey): string {
  return MOVIE_EDITION_REGISTRY[edition].displayLabel;
}

export function movieScope(
  title: Title,
  edition: MovieEditionKey,
): MovieEditionScope {
  return { rootMediaId: title.id, mediaId: title.id, edition };
}

export function definitionDigest(
  title: Title,
  edition: MovieEditionKey,
): string {
  return sha256(`definition:${title.id}:${edition}`);
}

export type MovieRequestSeed = {
  sequence: number;
  title: Title;
  edition: MovieEditionKey;
  fulfillment: MovieEditionFulfillment;
  active: boolean;
  access: "detail" | "protection_only";
  activationRequired: boolean;
  /** False while the requester still has to choose which cut they want. */
  chosen: boolean;
};

const FULFILLED: MovieEditionFulfillment = {
  status: "fulfilled",
  reason: null,
};
const PENDING_ASSET: MovieEditionFulfillment = {
  status: "pending_asset",
  reason: "movie_edition_asset_unavailable",
};

function seed(
  sequence: number,
  title: string,
  fulfillment: MovieEditionFulfillment,
  overrides: Partial<MovieRequestSeed> = {},
): MovieRequestSeed {
  return {
    sequence,
    title: titleNamed(title),
    edition: "default",
    fulfillment,
    active: true,
    access: "detail",
    activationRequired: false,
    chosen: true,
    ...overrides,
  };
}

/** One movie request per fulfillment state the client can render. */
export const MOVIE_REQUESTS: readonly MovieRequestSeed[] = [
  seed(16, "Dune: Part Two", FULFILLED),
  seed(17, "Anora", PENDING_ASSET),
  seed(
    18,
    "Oppenheimer",
    { status: "pending_choice", reason: "movie_edition_choice_required" },
    { chosen: false },
  ),
  seed(
    19,
    "Blade Runner",
    { status: "pending_edition", reason: "edition_acquisition_not_ready" },
    { edition: "final_cut" },
  ),
  seed(20, "The Lord of the Rings: The Fellowship of the Ring", FULFILLED, {
    edition: "extended_cut",
  }),
  seed(
    21,
    "Alien",
    { status: "protected", reason: "edition_evidence_ambiguous" },
    { edition: "directors_cut" },
  ),
  seed(22, "The Matrix", PENDING_ASSET, { activationRequired: true }),
  seed(23, "Heat", FULFILLED, { active: false }),
  seed(
    24,
    "The Social Network",
    { status: "protected", reason: "plex_library_access_required" },
    { access: "protection_only" },
  ),
  seed(25, "Arrival", PENDING_ASSET),
];

export function choiceId(request: MovieRequestSeed): string | null {
  return request.chosen ? fixtureId(9, 400 + request.sequence) : null;
}

export function requestVersion(request: MovieRequestSeed): number {
  return (request.sequence % 4) + 1;
}

export function movieRequestsFor(title: Title): MovieRequestSeed[] {
  return MOVIE_REQUESTS.filter((request) => request.title === title);
}

/** A subject's movie requests; a managed profile holds only a couple. */
export function movieRequestList(subjectUserId: string): MovieRequestList {
  const requests =
    subjectUserId === KIDS.id ? MOVIE_REQUESTS.slice(4, 6) : MOVIE_REQUESTS;
  return {
    schemaVersion: 4,
    subjectUserId,
    items: requests.map((request) => {
      const common = {
        requestId: requestId(request.sequence),
        scope: movieScope(request.title, request.edition),
        active: request.active,
        targetVersion: (request.sequence % 3) + 1,
        requestVersion: requestVersion(request),
        choiceRevision: request.chosen ? 1 : 0,
        choiceId: choiceId(request),
        fulfillment: request.fulfillment,
        canCancel: request.active,
        canRevokeChoice:
          request.active && request.chosen && request.edition !== "default",
        activationRequired: request.activationRequired,
      };
      return request.access === "protection_only"
        ? { ...common, access: "protection_only" }
        : {
            ...common,
            access: "detail",
            title: request.title.title,
            year: request.title.year,
            editionLabel: editionLabel(request.edition),
          };
    }),
    nextCursor: null,
  };
}

/** The edition picker's seven options for one movie and one subject. */
export function movieEditionContext(
  title: Title,
  subjectUserId: string,
): MovieEditionContext {
  const requests = movieRequestsFor(title);
  return {
    schemaVersion: 4,
    mediaId: title.id,
    subjectUserId,
    access: "detail",
    mediaVersion: versionOf(title.id),
    registryVersion: 1,
    options: EDITIONS.map((edition, index) => {
      const request = requests.find(
        (candidate) => candidate.edition === edition && candidate.chosen,
      );
      const digest = definitionDigest(title, edition);
      const stored = edition === "default" || request !== undefined;
      const blocked = edition === "unrated_cut";
      return {
        edition,
        definitionVersion: 0,
        definitionDigest: digest,
        displayLabel: editionLabel(edition),
        policy: MOVIE_EDITION_REGISTRY[edition].policy,
        storedDefinition: stored
          ? { definitionVersion: 0, definitionDigest: digest }
          : null,
        targetVersion: stored ? (index % 3) + 1 : null,
        request:
          request === undefined
            ? null
            : {
                id: requestId(request.sequence),
                version: requestVersion(request),
                choiceRevision: 1,
                choiceId: choiceId(request),
              },
        acquisition: blocked ? "protected" : "eligible",
        reasons: blocked ? ["quality_profile_required"] : [],
        activationRequired: request?.activationRequired ?? false,
      };
    }),
    pendingDemands: requests
      .filter((request) => !request.chosen)
      .map((request) => ({
        requestId: requestId(request.sequence),
        reason: "movie_edition_choice_required",
        choiceId: null,
        fulfillment: "pending_choice",
      })),
  };
}
