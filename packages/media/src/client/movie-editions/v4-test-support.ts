import {
  MovieEditionContextV4Schema,
  MovieEditionRequestViewV4Schema,
  MovieTargetContextV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
} from "#shared/movie-editions/registry.ts";

export const movieV4Ids = {
  media: "10000000-0000-4000-8000-000000000001",
  subject: "10000000-0000-4000-8000-000000000002",
  request: "10000000-0000-4000-8000-000000000003",
  choice: "10000000-0000-4000-8000-000000000004",
  asset: "10000000-0000-4000-8000-000000000005",
};
export const movieV4Scope = {
  rootMediaId: movieV4Ids.media,
  mediaId: movieV4Ids.media,
  edition: "directors_cut" as const,
};

export function movieV4ChoiceContext() {
  return MovieEditionContextV4Schema.parse({
    schemaVersion: 4,
    mediaId: movieV4Ids.media,
    subjectUserId: movieV4Ids.subject,
    access: "detail",
    mediaVersion: 8,
    registryVersion: 1,
    pendingDemands: [],
    options: MovieEditionKeySchema.options.map((edition) => ({
      edition,
      definitionVersion: 0,
      definitionDigest: "a".repeat(64),
      displayLabel: MOVIE_EDITION_REGISTRY[edition].displayLabel,
      policy: MOVIE_EDITION_REGISTRY[edition].policy,
      storedDefinition: null,
      targetVersion: edition === "directors_cut" ? 11 : 19,
      request:
        edition === "directors_cut"
          ? {
              id: movieV4Ids.request,
              version: 3,
              choiceRevision: 2,
              choiceId: movieV4Ids.choice,
            }
          : null,
      acquisition: "eligible",
      reasons: [],
      activationRequired: edition === "directors_cut",
    })),
  });
}

export function movieV4SavedRequest() {
  return MovieEditionRequestViewV4Schema.parse({
    access: "detail",
    scope: movieV4Scope,
    requestId: movieV4Ids.request,
    active: true,
    targetVersion: 11,
    requestVersion: 3,
    choiceRevision: 2,
    choiceId: movieV4Ids.choice,
    activationRequired: true,
    fulfillment: {
      status: "pending_edition",
      reason: "edition_acquisition_not_ready",
    },
    canCancel: true,
    canRevokeChoice: true,
    title: "Synthetic Movie",
    year: 2020,
    editionLabel: "Director's cut",
  });
}

export function movieV4Target() {
  return MovieTargetContextV4Schema.parse({
    schemaVersion: 4,
    scope: movieV4Scope,
    access: "detail",
    expected: { mediaVersion: 8, targetVersion: 11 },
    ownRequests: [],
    ownHold: null,
    allowedProtectiveActions: ["keep", "pin", "unpin"],
    title: "Synthetic Movie",
    year: 2020,
    editionLabel: "Director's cut",
    target: {
      generation: 2,
      availability: "available",
      desiredPresence: true,
      monitoring: true,
      libraryMonitoring: false,
    },
    allowedActions: ["keep", "pin", "unpin", "remove"],
    reasons: [],
    currentAsset: null,
    progress: null,
    removalConfirmation: {
      scope: movieV4Scope,
      fileSetHash: "a".repeat(64),
      assets: [
        {
          assetId: movieV4Ids.asset,
          assetVersion: 2,
          checksum: "b".repeat(64),
        },
      ],
    },
  });
}
