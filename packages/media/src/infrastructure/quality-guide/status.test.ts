import { expect, test } from "vitest";
import { policyStatus } from "#infrastructure/subtitle-policy.ts";
import type { SubtitleQuality } from "#domain/subtitle-quality.ts";

const asset = {
  id: "video",
  checksum: "a".repeat(64),
  version: 3,
  owned: true,
  ownershipEpoch: 2,
  state: "published",
  properties: { audioLanguages: ["ja"] },
  subtitles: new Array<SubtitleQuality>(),
};
const household = {
  targets: [
    {
      language: "en" as const,
      forced: false as const,
      hearingImpaired: "any" as const,
    },
  ],
  reasons: [],
  binding: {
    profileId: "profile",
    profileVersion: 4,
    originalLanguage: "ja",
    enabled: true,
  },
};
const caption: SubtitleQuality = {
  assetId: asset.id,
  language: "en",
  state: "installed",
  qualityStatus: "accepted",
  storageKind: "sidecar",
  ownershipEpoch: 2,
  videoChecksum: asset.checksum,
  videoVersion: 3,
  checksum: "b".repeat(64),
  forced: false,
  hearingImpaired: false,
  streamIndex: null,
  codec: null,
};

test("the file detail displays household missing targets without inventing imported source IDs", () => {
  expect(
    policyStatus({ policy: undefined, asset, epoch: 2, household }),
  ).toMatchObject({
    satisfied: false,
    missing: [],
    householdMissing: household.targets,
  });
  expect(
    policyStatus({
      policy: undefined,
      asset: { ...asset, subtitles: [caption] },
      epoch: 2,
      household,
    }),
  ).toMatchObject({ satisfied: true, householdMissing: [] });
  expect(
    policyStatus({
      policy: undefined,
      asset: { ...asset, subtitles: [{ ...caption, forced: true }] },
      epoch: 2,
      household,
    }),
  ).toMatchObject({ satisfied: false, householdMissing: household.targets });
  expect(
    policyStatus({
      policy: undefined,
      asset: { ...asset, subtitles: [{ ...caption, videoVersion: 2 }] },
      epoch: 2,
      household,
    })?.satisfied,
  ).toBe(false);
  expect(policyStatus({ policy: undefined, asset, epoch: 2 })).toBeNull();
});
