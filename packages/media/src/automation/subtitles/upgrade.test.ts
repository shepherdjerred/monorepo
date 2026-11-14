import { expect, it } from "vitest";
import { SubtitleMatchScoreV1Schema } from "#shared/subtitle-maintenance/score.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import {
  findReusableSubtitleV1,
  subtitleUpgradeCurrentV1,
  assertSubtitleUpgradeOperationV1,
} from "./upgrade.ts";

const video = "a".repeat(64),
  authority = "b".repeat(64);
const target = {
  language: "en",
  forced: false,
  hearingImpaired: "any" as const,
};
const common = {
  schemaVersion: 1,
  weights: "bazarr-1.6.2",
  matcher: "media-evidence-v1",
  kind: "episode",
  maximum: 360,
  catalogStatus: "confirmed",
  referenceHash: "c".repeat(64),
};
const low = SubtitleMatchScoreV1Schema.parse({
  ...common,
  score: 335,
  matches: ["series", "year", "season", "episode", "source"],
});
const high = SubtitleMatchScoreV1Schema.parse({
  ...common,
  score: 355,
  matches: [...low.matches, "release_group"],
});
function fixture() {
  const old = {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    assetId: "video",
    language: "en",
    providerId: "opensubtitles",
    provenance: {},
    matchingEvidence: { targetAuthority: authority, matchScoreV1: low },
    content: null,
    path: "/library/film.en.srt",
    storageKind: "sidecar",
    checksum: "d".repeat(64),
    qualityStatus: "accepted",
    ownershipEpoch: 0,
    state: "installed",
    forced: false,
    hearingImpaired: null,
    streamIndex: null,
    codec: null,
    videoChecksum: video,
    videoVersion: 1,
    createdAt: new Date(),
  };
  const candidate = {
    ...old,
    id: "00000000-0000-4000-8000-000000000002",
    state: "validated",
    checksum: "e".repeat(64),
    matchingEvidence: { targetAuthority: authority, matchScoreV1: high },
  };
  const work = {
    asset: {
      id: "video",
      checksum: video,
      version: 1,
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      properties: {},
      subtitles: [old, candidate],
    },
    targets: [target],
    authority,
    protectedReasons: [],
  };
  return {
    old,
    candidate,
    work,
    upgrade: {
      oldSubtitleId: old.id,
      oldVersion: old.version,
      oldChecksum: old.checksum,
      minimumScore: low,
    },
  };
}
it("upgrade lookup rechecks the installed parent and returns only a genuinely higher-scoring staged candidate", () => {
  const f = fixture();
  expect(subtitleUpgradeCurrentV1(f.work, f.upgrade, target)).toBe(true);
  expect(findReusableSubtitleV1(f.work, 0, target, f.upgrade)?.id).toBe(
    f.candidate.id,
  );
  expect(
    subtitleUpgradeCurrentV1(f.work, { ...f.upgrade, oldVersion: 2 }, target),
  ).toBe(false);
  f.candidate.matchingEvidence.matchScoreV1 = low;
  expect(findReusableSubtitleV1(f.work, 0, target, f.upgrade)).toBeUndefined();
  expect(() =>
    assertSubtitleUpgradeOperationV1(
      { assetId: "video", upgradeV1: f.upgrade },
      { assetId: "video", upgradeV1: { ...f.upgrade, oldChecksum: video } },
    ),
  ).toThrow();
});
it("a downloaded unknown-flag candidate can retry measurement without becoming a usable regular track", () => {
  const f = fixture();
  const pending = {
    ...f.candidate,
    forced: null,
    matchingEvidence: {
      ...f.candidate.matchingEvidence,
      regularDialogueRequiredV1: true,
    },
  };
  const work = { ...f.work, asset: { ...f.work.asset, subtitles: [pending] } };
  expect(findReusableSubtitleV1(work, 0, target)?.id).toBe(pending.id);
  expect(
    subtitleAccepted({
      subtitle: pending,
      asset: work.asset,
      epoch: 0,
      target,
    }),
  ).toBe(false);
  expect(pending.forced).toBeNull();
});
