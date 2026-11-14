import { expect, test } from "vitest";
import { personalSourceSelection } from "./personal-accounting.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";

function fixture() {
  const captureId = crypto.randomUUID();
  const capture = {
    manifestHash: "a".repeat(64),
    sourceKind: "seerr" as const,
    sourceInstanceId: "b".repeat(64),
  };
  const payload = {
    kind: "request",
    sourceId: "4",
    requesterSourceId: "17",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: 42 },
    scope: "movie",
    seasons: [],
    sourceStatus: 5,
    seasonStatuses: [],
    active: true,
  };
  const provenanceKey = recordKey(capture, {
    kind: "request",
    sourceId: payload.sourceId,
  });
  const observationHash = snapshotHash(payload);
  const stored = {
    captureId,
    capture,
    payload,
    provenanceKey,
    observationHash,
  };
  const claim = {
    captureId,
    provenanceKey,
    sourceId: "4",
    requesterSourceId: "17",
    sourceStatus: 5,
    disposition: "history",
    reason: "owner_reviewed_history_only",
    userId: null,
    bindingId: null,
    bindingRevision: null,
    mediaIds: [],
    edition: null,
    keepingPolicy: "temporary",
    interestState: "following",
  };
  const receipt = {
    schemaVersion: 1,
    captures: [
      { id: captureId, captureHash: capture.manifestHash, sourceKind: "seerr" },
    ],
    claims: [claim],
    sourceRecords: [{ captureId, provenanceKey, observationHash }],
    imports: [],
    keepingPolicy: "temporary",
    interestState: "following",
    changesPlaybackState: false,
    transfersTorrentOwnership: false,
  };
  return { stored, receipt, claim };
}
test("owner historical disposition still requires the exact captured source and record hash", () => {
  const f = fixture();
  expect(personalSourceSelection(f.receipt, f.stored)?.selected).toEqual(
    f.claim,
  );
  expect(
    personalSourceSelection(
      {
        ...f.receipt,
        captures: [{ ...f.receipt.captures[0], captureHash: "c".repeat(64) }],
      },
      f.stored,
    ),
  ).toBeNull();
  expect(
    personalSourceSelection(
      {
        ...f.receipt,
        sourceRecords: [
          { ...f.receipt.sourceRecords[0], observationHash: "c".repeat(64) },
        ],
      },
      f.stored,
    ),
  ).toBeNull();
  expect(
    personalSourceSelection(
      {
        ...f.receipt,
        claims: [{ ...f.claim, requesterSourceId: "recycled-account" }],
      },
      f.stored,
    ),
  ).toBeNull();
  expect(
    personalSourceSelection(f.receipt, {
      ...f.stored,
      payload: { ...f.stored.payload, sourceStatus: 3 },
    }),
  ).toBeNull();
  expect(
    personalSourceSelection(f.receipt, {
      ...f.stored,
      capture: { ...f.stored.capture, sourceInstanceId: "d".repeat(64) },
    }),
  ).toBeNull();
});
