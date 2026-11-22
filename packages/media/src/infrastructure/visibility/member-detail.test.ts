import { expect, test } from "vitest";
import { MediaDetailSchema, type MediaDetail } from "#shared/api.ts";
import {
  MovieTargetContextV4Schema,
  type MovieTargetContextV4,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import { memberDetail, memberMovieTarget } from "./member-detail.ts";

function ownerDetail(): MediaDetail {
  const torrentId = crypto.randomUUID();
  const id = crypto.randomUUID();
  return MediaDetailSchema.parse({
    id,
    kind: "movie",
    title: "Projected movie",
    year: 2020,
    parentId: null,
    seasonNumber: null,
    episodeNumber: null,
    availability: "downloading",
    version: 4,
    rootMediaId: id,
    artwork: {
      posterPath: "/aBcDeFgH1234.jpg",
      backdropPath: "/hGfEdCbA4321.jpg",
    },
    overview: "A movie a member may read about.",
    catalog: { kind: "movie", externalId: 603 },
    policy: "keep",
    libraryKeeping: {
      mediaVersion: 4,
      targetVersion: 3,
      keepingPolicy: "keep",
    },
    visibility: {
      movieRequests: [],
      playback: {
        scope: "title",
        playable: false,
        playableItems: 0,
        visibleItems: 1,
        association: {
          legacyUnverifiedItems: 0,
          reconciliationRequiredItems: 0,
        },
        currentAssetId: null,
        currentVersion: null,
        upgradeInProgress: false,
      },
      attempts: [
        {
          id: crypto.randomUUID(),
          state: "downloading",
          torrentId,
          createdAt: "2026-10-17T00:00:00Z",
          currentEpoch: true,
        },
      ],
      torrents: [
        {
          id: torrentId,
          state: "downloading",
          observedAt: "2026-10-17T00:05:00Z",
          freshness: "fresh",
          progress: 0.4,
          ratio: { kind: "finite", value: 0.2 },
          seededSeconds: 120,
          diagnostics: null,
        },
      ],
      historyTruncated: false,
    },
    subtitlePolicies: [
      {
        id: crypto.randomUUID(),
        version: 1,
        recoveryEpoch: 0,
        rules: {
          schemaVersion: 1,
          targets: [
            {
              sourceItemId: 7,
              language: "en",
              audioLanguage: "ja",
              forced: false,
              hearingImpaired: "any",
              audio: "any",
            },
          ],
          protectedReasons: [],
        },
      },
    ],
    children: [],
    intent: {
      generation: 2,
      desiredPresence: true,
      monitoring: true,
      profileId: "profile-1080p",
      version: 3,
      intentionallyRemovedAt: null,
    },
    requests: [
      {
        id: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        subtitleLanguages: ["en"],
        version: 2,
        user: { displayName: "Requester" },
        interestRevision: 5,
        interestState: "following",
      },
      {
        id: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        subtitleLanguages: [],
        version: 0,
        user: { displayName: "Covered by a series request" },
        interestRevision: null,
        interestState: null,
      },
    ],
    holds: [],
    retention: [],
    watchStates: [],
    assets: [],
    events: [],
  });
}

test("a member keeps progress, state and freshness while acquisition detail is withheld", () => {
  const owner = ownerDetail();
  const member = memberDetail(owner);
  expect(member.visibility.attempts).toEqual([]);
  expect(member.visibility.torrents).toEqual([
    {
      id: owner.visibility.torrents[0]?.id,
      state: "downloading",
      freshness: "fresh",
      progress: 0.4,
      observedAt: null,
      ratio: null,
      seededSeconds: null,
      diagnostics: null,
    },
  ]);
  expect(member.intent).toEqual({ ...owner.intent, profileId: null });
  expect(member.subtitlePolicies).toEqual([]);
  expect(member.visibility.playback).toEqual(owner.visibility.playback);
  expect(member.visibility.historyTruncated).toBe(false);
});

test("a member reads how long the title is kept and never the owner's keeping switch", () => {
  const owner = ownerDetail();
  const member = memberDetail(owner);
  expect(owner.libraryKeeping).toEqual({
    mediaVersion: 4,
    targetVersion: 3,
    keepingPolicy: "keep",
  });
  expect(member.policy).toBe("keep");
  expect(member.libraryKeeping).toBeNull();
  // The read scopes requests to the reader; the projection passes them through.
  expect(member.requests).toEqual(owner.requests);
  expect(
    member.requests.map((request) => [
      request.interestRevision,
      request.interestState,
    ]),
  ).toEqual([
    [5, "following"],
    [null, null],
  ]);
});

test("the projection changes nothing else and stays within the existing strict contract", () => {
  const owner = ownerDetail();
  const member = memberDetail(owner);
  const { visibility, intent, subtitlePolicies, libraryKeeping, ...rest } =
    member;
  const {
    visibility: _visibility,
    intent: _intent,
    subtitlePolicies: _subtitlePolicies,
    libraryKeeping: _libraryKeeping,
    ...ownerRest
  } = owner;
  expect(rest).toEqual(ownerRest);
  expect(MediaDetailSchema.parse(structuredClone(member))).toEqual({
    ...rest,
    visibility,
    intent,
    subtitlePolicies,
    libraryKeeping,
  });
});

test("a title with no intent stays without one", () => {
  const member = memberDetail({ ...ownerDetail(), intent: null });
  expect(member.intent).toBeNull();
});

function ownerMovieTarget(
  progress: MediaDetail["visibility"] | null,
): MovieTargetContextV4 {
  const mediaId = crypto.randomUUID();
  return MovieTargetContextV4Schema.parse({
    schemaVersion: 4,
    scope: { rootMediaId: mediaId, mediaId, edition: "directors_cut" },
    access: "detail",
    expected: { mediaVersion: 8, targetVersion: 11 },
    ownRequests: [],
    ownHold: null,
    allowedProtectiveActions: ["keep"],
    title: "Projected movie",
    year: 2020,
    editionLabel: "Director's cut",
    target: {
      generation: 2,
      availability: "downloading",
      desiredPresence: true,
      monitoring: true,
      libraryMonitoring: false,
    },
    allowedActions: ["keep"],
    reasons: ["acquisition_active"],
    removalConfirmation: null,
    currentAsset: null,
    progress:
      progress === null
        ? null
        : {
            attempts: progress.attempts,
            torrents: progress.torrents,
            historyTruncated: true,
          },
  });
}

test("a member's movie edition keeps its transfer while acquisition detail is withheld", () => {
  const owner = ownerMovieTarget(ownerDetail().visibility);
  const member = memberMovieTarget(owner);
  if (owner.access !== "detail" || member.access !== "detail")
    throw new Error("Fixture lost its detail access");
  expect(owner.progress?.attempts).toHaveLength(1);
  expect(member.progress).toEqual({
    attempts: [],
    torrents: [
      {
        id: owner.progress?.torrents[0]?.id,
        state: "downloading",
        freshness: "fresh",
        progress: 0.4,
        observedAt: null,
        ratio: null,
        seededSeconds: null,
        diagnostics: null,
      },
    ],
    historyTruncated: true,
  });
  const { progress: _progress, ...rest } = member;
  const { progress: _ownerProgress, ...ownerRest } = owner;
  expect(rest).toEqual(ownerRest);
  expect(MovieTargetContextV4Schema.parse(structuredClone(member))).toEqual(
    member,
  );
});

test("a movie edition without progress or detail access is returned as it is", () => {
  const withoutProgress = ownerMovieTarget(null);
  expect(memberMovieTarget(withoutProgress)).toBe(withoutProgress);
  const protectionOnly = MovieTargetContextV4Schema.parse({
    schemaVersion: 4,
    scope: withoutProgress.scope,
    access: "protection_only",
    expected: withoutProgress.expected,
    ownRequests: [],
    ownHold: null,
    allowedProtectiveActions: [],
  });
  expect(memberMovieTarget(protectionOnly)).toBe(protectionOnly);
});
