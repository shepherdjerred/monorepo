import { expect, it } from "vitest";
import {
  subtitleMetadataMatches,
  requireUntargetedProvider,
} from "./subtitle-sources.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";

const target = {
  language: "zh-Hans",
  forced: false,
  hearingImpaired: "any" as const,
};
it("permits a regular Chinese lookup while preserving forced and hearing-impaired constraints", () => {
  expect(() => requireUntargetedProvider(target, "assrt")).not.toThrow();
  expect(() =>
    requireUntargetedProvider({ ...target, forced: true }, "assrt"),
  ).toThrow("unsupported-target");
  expect(() =>
    requireUntargetedProvider(
      { ...target, hearingImpaired: "required" },
      "subhd",
    ),
  ).toThrow("unsupported-target");
  expect(
    subtitleMetadataMatches(target, { forced: null, hearingImpaired: null }),
  ).toBe(false);
  expect(
    subtitleMetadataMatches(
      target,
      { forced: null, hearingImpaired: null },
      true,
    ),
  ).toBe(true);
  expect(
    subtitleMetadataMatches(
      { ...target, forced: true },
      { forced: null, hearingImpaired: null },
      true,
    ),
  ).toBe(false);
  expect(
    subtitleMetadataMatches(
      { ...target, language: "ja" },
      { forced: null, hearingImpaired: null },
      true,
    ),
  ).toBe(false);
});
it("requires checksum-bound independent audio evidence before an unknown-flag track satisfies regular captions", () => {
  const asset = {
    id: "video",
    checksum: "a".repeat(64),
    version: 1,
    owned: true,
    ownershipEpoch: 0,
    state: "published",
  };
  const subtitle = {
    assetId: asset.id,
    language: "zh-Hans",
    state: "installed",
    qualityStatus: "accepted",
    storageKind: "sidecar",
    ownershipEpoch: 0,
    videoChecksum: asset.checksum,
    videoVersion: 1,
    checksum: "b".repeat(64),
    forced: null,
    hearingImpaired: null,
    streamIndex: null,
    codec: null,
  };
  expect(subtitleAccepted({ subtitle, asset, epoch: 0, target })).toBe(false);
  const regularDialogueV1 = {
    schemaVersion: 1,
    detector: "ffsubsync-0.5.1/webrtc",
    videoChecksum: asset.checksum,
    subtitleChecksum: subtitle.checksum,
    runtimeMs: 120_000,
    speechMs: 60_000,
    coveredSpeechMs: 60_000,
    windows: Array.from({ length: 12 }, () => ({
      speechMs: 5000,
      coveredSpeechMs: 5000,
    })),
  };
  const measured = { ...subtitle, matchingEvidence: { regularDialogueV1 } };
  expect(
    subtitleAccepted({ subtitle: measured, asset, epoch: 0, target }),
  ).toBe(true);
  expect(measured.forced).toBeNull();
  expect(
    subtitleAccepted({
      subtitle: { ...measured, checksum: "c".repeat(64) },
      asset,
      epoch: 0,
      target,
    }),
  ).toBe(false);
});
