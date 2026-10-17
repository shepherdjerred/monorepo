import { expect, test } from "vitest";
import type { ReleaseAttributes } from "#shared/contract.ts";
import type { AcquisitionIdentitySnapshot } from "#shared/acquisition/identity.ts";
import { effectiveCandidate } from "./effective.ts";

const mediaId = crypto.randomUUID();
const releaseId = crypto.randomUUID();
const snapshot: AcquisitionIdentitySnapshot = {
  schemaVersion: 1,
  source: { releaseId, candidateDigest: "a".repeat(64) },
  proof: {
    kind: "owner",
    decisionOperationId: crypto.randomUUID(),
    decisionHash: "b".repeat(64),
  },
  canonical: {
    kind: "movie",
    mediaId,
    mediaVersion: 0,
    catalogDigest: "c".repeat(64),
  },
  coverage: [mediaId],
  sponsorRequestId: crypto.randomUUID(),
  sponsorAuthority: {
    userId: crypto.randomUUID(),
    actorId: crypto.randomUUID(),
    serverMachineId: "fixture-server",
  },
  birthEpoch: 0,
};
const candidate: ReleaseAttributes = {
  id: releaseId,
  providerId: "fixture",
  title: "Ambiguous.Title.1080p.WEB-DL",
  sizeBytes: 1000,
  mediaIds: [],
  identityConfidence: "ambiguous",
  quality: "WEB-1080p",
  codec: "H264",
  audioLanguages: [],
  scoreTags: ["rejected"],
  resolvedEvidence: {
    schemaVersion: 1,
    source: "sonarr",
    sourceVersion: "4.0.20.3014",
    parserVersion: "scene-anime-v2",
    protectedReasons: ["audio_unconfirmed"],
    release: {
      id: releaseId,
      qualityId: 3,
      identityConfirmed: false,
      releaseTitle: "Ambiguous.Title",
      filename: "",
      releaseGroup: null,
      revision: null,
      sizeBytes: 1000,
      runtimeMinutes: null,
      originalLanguage: null,
      audioLanguages: null,
      specialEpisode: false,
    },
    regex: {
      engine: "dotnet-ignorecase",
      culture: "en-US",
      observations: [
        { pattern: "bad", value: "Ambiguous.Title", result: "unknown" },
      ],
    },
  },
};

test("verified identity updates both predicates and preserves every independent quality limitation", () => {
  const before = structuredClone(candidate);
  const projected = effectiveCandidate(candidate, snapshot);
  expect(projected.identityConfidence).toBe("exact");
  expect(projected.mediaIds).toEqual([mediaId]);
  expect(projected.resolvedEvidence?.release.identityConfirmed).toBe(true);
  expect(projected).toEqual({
    ...candidate,
    mediaIds: [mediaId],
    identityConfidence: "exact",
    resolvedEvidence: {
      ...candidate.resolvedEvidence,
      release: {
        ...candidate.resolvedEvidence?.release,
        identityConfirmed: true,
      },
    },
  });
  expect(candidate).toEqual(before);
});
test("missing quality evidence stays missing and foreign proof cannot be projected", () => {
  const { resolvedEvidence: omitted, ...withoutEvidence } = candidate;
  expect(omitted).toBeDefined();
  expect(effectiveCandidate(withoutEvidence, snapshot)).not.toHaveProperty(
    "resolvedEvidence",
  );
  expect(() =>
    effectiveCandidate(candidate, {
      ...snapshot,
      source: { ...snapshot.source, releaseId: crypto.randomUUID() },
    }),
  ).toThrow("different release");
  expect(() =>
    effectiveCandidate(candidate, {
      ...snapshot,
      coverage: [crypto.randomUUID()],
    }),
  ).toThrow("canonical coverage");
});
