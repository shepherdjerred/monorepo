import { expect, test } from "vitest";
import { z } from "zod";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { MovieSubtitleReceiptV4Schema } from "#shared/movie-editions/subtitle-receipt-v4.ts";
import {
  assertMovieSubtitleCandidateVersionV4,
  assertMovieSubtitleReceiptV4,
} from "./subtitle-receipt.ts";

const video = "a".repeat(64),
  caption = "b".repeat(64);
function subject() {
  const mediaId = crypto.randomUUID();
  const target = MovieSubtitleOperationV4Schema.parse({
    schemaVersion: 4,
    operationId: crypto.randomUUID(),
    scope: { rootMediaId: mediaId, mediaId, edition: "directors_cut" },
    assetId: crypto.randomUUID(),
    recoveryEpoch: 0,
    targetAuthority: "c".repeat(64),
    language: "en",
    forced: false,
    hearingImpaired: "any",
  });
  const candidate = {
    version: 1,
    forced: null,
    language: "en",
    ownershipEpoch: 0,
    videoVersion: 0,
    videoChecksum: video,
    checksum: caption,
    matchingEvidence: {
      schemaVersion: 4,
      operationId: target.operationId,
      movieScope: target.scope,
      targetAuthority: target.targetAuthority,
      assetVersion: 0,
      assetChecksum: video,
      recoveryEpoch: 0,
      regularDialogueRequiredV1: true,
      regularDialogueV1: {
        schemaVersion: 1,
        detector: "ffsubsync-0.5.1/webrtc",
        videoChecksum: video,
        subtitleChecksum: caption,
        runtimeMs: 4000,
        speechMs: 1200,
        coveredSpeechMs: 1200,
        windows: Array.from({ length: 12 }, () => ({
          speechMs: 100,
          coveredSpeechMs: 100,
        })),
      },
      timingAlignedV1: {
        schemaVersion: 1,
        videoChecksum: video,
        subtitleChecksum: caption,
        engine: "ffsubsync-0.5.1",
        maxOffsetSeconds: 60,
        goldenSectionRequested: true,
        fixFrameRate: false,
      },
    },
  };
  return { target, candidate };
}

function receipt() {
  const { target, candidate } = subject();
  const subtitleId = crypto.randomUUID();
  const input = {
    schemaVersion: 4,
    operationId: target.operationId,
    scope: target.scope,
    assetId: target.assetId,
    subtitleId,
  };
  const before = {
    ...candidate,
    id: subtitleId,
    assetId: target.assetId,
    state: "validated",
    qualityStatus: "accepted",
    storageKind: "sidecar",
    language: "en",
    providerId: "fixture",
    path: null,
    forced: null,
    hearingImpaired: null,
    streamIndex: null,
    codec: null,
    provenance: { format: "srt" },
    contentChecksum: caption,
  };
  const path = "/data/movies/Example.en.srt";
  return MovieSubtitleReceiptV4Schema.parse({
    schemaVersion: 4,
    input,
    target,
    command: {
      kind: "acquire_movie_subtitles_v4",
      targetId: target.assetId,
      payloadHash: "d".repeat(64),
    },
    publication: {
      kind: "movie_publication_transition_v2",
      scope: target.scope,
      transitionId: crypto.randomUUID(),
      intentHash: "d".repeat(64),
      outcomeHash: "d".repeat(64),
      assetId: target.assetId,
      assetVersion: 0,
      bindingHash: "d".repeat(64),
      physicalEvidenceHash: "d".repeat(64),
    },
    videoPath: "/data/movies/Example.mkv",
    before,
    after: {
      ...before,
      state: "installed",
      version: 2,
      path,
      provenance: { format: "srt", checksum: caption },
      matchingEvidence: {
        ...before.matchingEvidence,
        target: { language: "en", forced: false, hearingImpaired: "any" },
        movieInstallationV4: {
          schemaVersion: 4,
          operationId: target.operationId,
        },
      },
    },
    journal: {
      version: 1,
      operationId: target.operationId,
      kind: "import",
      source: `/data/movies/.media-control/subtitles/${subtitleId}.srt`,
      target: path,
      sha256: caption,
      previousSha256: null,
      phase: "complete",
    },
    observedAt: "2026-11-14T00:00:00.000Z",
    committedAt: "2026-11-14T00:00:01.000Z",
    expiresAt: "2026-11-14T00:00:10.000Z",
    sdkExpiresAt: "2026-11-14T00:00:20.000Z",
  });
}

test("legacy unmeasured candidate installation remains version zero to one", () => {
  const r = receipt();
  r.before.version = 0;
  r.after.version = 1;
  r.before.forced = r.after.forced = false;
  expect(() => assertMovieSubtitleReceiptV4(r)).not.toThrow();
  const { target, candidate } = subject();
  expect(() =>
    assertMovieSubtitleCandidateVersionV4(
      { ...candidate, version: 0, matchingEvidence: {} },
      target,
    ),
  ).not.toThrow();
});

test("prepared installation is exactly one to two without inventing a forced label", () => {
  const r = receipt();
  expect(() => assertMovieSubtitleReceiptV4(r)).not.toThrow();
  expect(r.after.forced).toBeNull();
});

test.each([
  "missing",
  "video",
  "caption",
  "scope",
  "operation",
  "authority",
  "totals",
  "coverage",
] as const)(
  "prepared candidate rejects %s evidence before physical publication",
  (change) => {
    const { candidate, target } = subject();
    const evidence = z
      .record(z.string(), z.json())
      .parse(candidate.matchingEvidence);
    if (change === "missing") delete evidence["timingAlignedV1"];
    if (change === "video") evidence["assetChecksum"] = "f".repeat(64);
    if (change === "caption")
      evidence["timingAlignedV1"] = {
        ...candidate.matchingEvidence.timingAlignedV1,
        subtitleChecksum: "f".repeat(64),
      };
    if (change === "scope")
      evidence["movieScope"] = { ...target.scope, edition: "theatrical_cut" };
    if (change === "operation") evidence["operationId"] = crypto.randomUUID();
    if (change === "authority") evidence["targetAuthority"] = "f".repeat(64);
    if (change === "totals")
      evidence["regularDialogueV1"] = {
        ...candidate.matchingEvidence.regularDialogueV1,
        speechMs: 1300,
      };
    if (change === "coverage")
      evidence["regularDialogueV1"] = {
        ...candidate.matchingEvidence.regularDialogueV1,
        coveredSpeechMs: 0,
        windows: Array.from({ length: 12 }, () => ({
          speechMs: 100,
          coveredSpeechMs: 0,
        })),
      };
    expect(() =>
      assertMovieSubtitleCandidateVersionV4(
        { ...candidate, matchingEvidence: evidence },
        target,
      ),
    ).toThrow("preparation changed");
  },
);

test.each([
  [0, 2],
  [1, 3],
  [2, 3],
] as const)("receipt rejects version %i to %i", (before, after) => {
  const r = receipt();
  r.before.version = before;
  r.after.version = after;
  expect(() => assertMovieSubtitleReceiptV4(r)).toThrow();
});

test.each(["forced", "required", "excluded"] as const)(
  "measurement does not invent %s metadata",
  (constraint) => {
    const r = receipt();
    if (constraint === "forced") r.target.forced = true;
    else r.target.hearingImpaired = constraint;
    expect(() => assertMovieSubtitleReceiptV4(r)).toThrow();
  },
);
