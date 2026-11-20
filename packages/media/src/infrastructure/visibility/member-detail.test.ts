import { expect, test } from "vitest";
import { MediaDetailSchema, type MediaDetail } from "#shared/api.ts";
import { memberDetail } from "./member-detail.ts";

function ownerDetail(): MediaDetail {
  const torrentId = crypto.randomUUID();
  return MediaDetailSchema.parse({
    id: crypto.randomUUID(),
    kind: "movie",
    title: "Projected movie",
    year: 2020,
    parentId: null,
    seasonNumber: null,
    episodeNumber: null,
    availability: "downloading",
    version: 4,
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
    requests: [],
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

test("the projection changes nothing else and stays within the existing strict contract", () => {
  const owner = ownerDetail();
  const member = memberDetail(owner);
  const { visibility, intent, subtitlePolicies, ...rest } = member;
  const {
    visibility: _visibility,
    intent: _intent,
    subtitlePolicies: _subtitlePolicies,
    ...ownerRest
  } = owner;
  expect(rest).toEqual(ownerRest);
  expect(MediaDetailSchema.parse(structuredClone(member))).toEqual({
    ...rest,
    visibility,
    intent,
    subtitlePolicies,
  });
});

test("a title with no intent stays without one", () => {
  const member = memberDetail({ ...ownerDetail(), intent: null });
  expect(member.intent).toBeNull();
});
