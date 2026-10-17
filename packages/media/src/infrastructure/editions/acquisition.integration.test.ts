import { rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { authorizedSubmission } from "#automation/reconciliation/submission.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { previewDefaultEdition } from "./acquisition.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";

const { database, context } = automationTestHarness();

test("another episode's title cannot hide a pack or single-member cut", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const second = await db.mediaItem.create({
      data: {
        kind: "episode",
        title: "Extended Cut",
        parentId: f.series.id,
        seasonNumber: 1,
        episodeNumber: 2,
        externalIds: { plexSectionId: "2", seriesTmdb: f.series.tmdbId },
      },
    });
    f.source.providerReleaseId = crypto.randomUUID();
    f.source.title =
      "Example.Show.2020.S01E01-E02.Extended.Cut.1080p.WEB-DL.H264.ENG";
    const profile = await loadProfile(db, f.files.media.id);
    if (profile === null) throw new Error("Fixture profile missing");
    expect(
      await searchCandidates(f.network, f.files.media.id, profile),
    ).toEqual([]);
    const release = await db.releaseCandidate.findUniqueOrThrow({
      where: {
        providerId_providerReleaseId: {
          providerId: f.source.providerId,
          providerReleaseId: f.source.providerReleaseId,
        },
      },
    });
    const preview = await f.service.identityPreview(
      f.actor,
      f.files.media.id,
      release.id,
      { mediaIds: [f.files.media.id, second.id] },
    );
    expect(preview).toMatchObject({
      confirmationAllowed: false,
      edition: { accepted: false, reasons: ["edition_candidate_incompatible"] },
    });
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    await expect(
      f.service.act(f.actor, crypto.randomUUID(), media.id, {
        action: "select_release",
        releaseId: release.id,
        expectedVersion: media.version,
      }),
    ).rejects.toMatchObject({ code: "edition_candidate_incompatible" });
    const member = await previewDefaultEdition(db, {
      releaseId: f.release.id,
      mediaIds: [f.files.media.id, second.id],
      members: [
        {
          kind: "torrent_member",
          attemptId: crypto.randomUUID(),
          torrentFileIndex: 0,
          relativePath: "Example.Show.S01E01.Extended.Cut.mkv",
        },
      ],
    });
    expect(member).toMatchObject({
      accepted: false,
      reasons: ["edition_candidate_incompatible"],
    });
    expect(f.adds()).toBe(0);
    expect(
      await db.acquisitionAttempt.count({ where: { releaseId: release.id } }),
    ).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("retry observes a recorded add after cut drift without submitting a second download", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const input = await f.select();
    const activities = createAcquisitionActivities(f.network);
    const reserved = await activities.reconcileMediaIntent(input);
    const attemptId = z.uuid().parse(reserved.attemptId);
    expect(
      await activities.submitMediaTorrent({
        operationId: input.operationId,
        attemptId,
      }),
    ).toMatchObject({ status: "submitted" });
    expect(f.adds()).toBe(1);
    // The external add is real; emulate loss of its database acknowledgement.
    await db.acquisitionAttempt.update({
      where: { id: attemptId },
      data: { state: "submission_unknown" },
    });
    await db.operation.update({
      where: { id: input.operationId },
      data: { status: "failed" },
    });
    await db.libraryAsset.create({
      data: {
        path: `${f.files.roots.library}/prior-recorded.mkv`,
        sourcePath: "/downloads/Example.Show.S01E01.Extended.Cut.mkv",
        sizeBytes: 10,
        checksum: "b".repeat(64),
        properties: { title: "Example.Show.S01E01.Extended.Cut.480p" },
        owned: true,
        state: "published",
        ownershipEpoch: 0,
        editionRootId: f.series.id,
        coverage: { create: { mediaId: f.files.media.id, current: true } },
      },
    });
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    const retry = await f.service.act(f.actor, crypto.randomUUID(), media.id, {
      action: "retry",
      expectedVersion: media.version,
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(retry.operationId) },
    });
    const retryInput = z
      .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
      .parse(operation.payload);
    expect(await activities.reconcileMediaIntent(retryInput)).toMatchObject({
      status: "acquire",
      attemptId,
    });
    expect(
      await activities.submitMediaTorrent({
        operationId: retryInput.operationId,
        attemptId,
      }),
    ).toMatchObject({ status: "submitted" });
    expect(f.adds()).toBe(1);
    const recovered = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    await expect(
      db.$transaction((tx) =>
        assertAttemptIdentity(tx, recovered, "fixture-server"),
      ),
    ).rejects.toMatchObject({
      code: "edition_current_requires_classification",
    });
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("legacy NULL attempt gets a cut check without receiving identity evidence", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const acquired = await f.files.acquisition();
    const before = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(before.identityEvidence).toBeNull();
    await db.releaseCandidate.update({
      where: { id: before.releaseId },
      data: { title: "Example.Show.S01E01.Extended.Cut.1080p" },
    });
    await expect(
      db.$transaction((tx) =>
        assertAttemptIdentity(tx, before, "fixture-server"),
      ),
    ).rejects.toMatchObject({ code: "edition_candidate_incompatible" });
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: before.id },
      }),
    ).toEqual(before);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("retained adopted original parent path participates; generated basename never substitutes missing provenance", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const published = await f.files.published();
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    });
    const input = { releaseId: f.release.id, mediaIds: [f.files.media.id] };
    await db.libraryAsset.update({
      where: { id: asset.id },
      data: {
        properties: {
          title: "Example Show canonical.mkv",
          resolvedEvidence: { parserVersion: "handoff-v1" },
        },
        sourcePath: "/imports/Example.Show.Extended.Cut/episode.mkv",
      },
    });
    expect(await previewDefaultEdition(db, input)).toMatchObject({
      accepted: false,
      reasons: ["edition_current_requires_classification"],
    });
    await db.libraryAsset.update({
      where: { id: asset.id },
      data: { sourcePath: "/imports/Example.Show.S01E01.1080p/episode.mkv" },
    });
    expect(await previewDefaultEdition(db, input)).toMatchObject({
      accepted: true,
    });
    await db.libraryAsset.update({
      where: { id: asset.id },
      data: { sourcePath: asset.path },
    });
    await expect(previewDefaultEdition(db, input)).rejects.toMatchObject({
      code: "edition_provenance_missing",
    });
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("named candidate blocks real automatic selection and owner identity confirmation before add", async () => {
  const db = database();
  const f = await identityFixture(
    db,
    context(),
    false,
    "Example.Show.2020.S01E01.Extended.Cut.1080p.WEB-DL.H264.ENG",
  );
  try {
    expect(await f.review()).toMatchObject({
      confirmationAllowed: false,
      edition: { accepted: false, reasons: ["edition_candidate_incompatible"] },
    });
    await expect(f.select()).rejects.toMatchObject({
      code: "identity_protected",
    });
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    await expect(
      f.service.act(f.actor, crypto.randomUUID(), media.id, {
        action: "select_release",
        releaseId: f.release.id,
        expectedVersion: media.version,
      }),
    ).rejects.toMatchObject({ code: "edition_candidate_incompatible" });
    expect(
      await db.acquisitionAttempt.count({ where: { releaseId: f.release.id } }),
    ).toBe(0);
    expect(f.adds()).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test.each([false, true])(
  "adding provider attribution cannot rewrite an existing snapshot (claimed=%s)",
  async (claimed) => {
    const db = database();
    const f = await identityFixture(db, context());
    try {
      if (claimed) await f.acquire();
      const before = await db.releaseCandidate.findUniqueOrThrow({
        where: { id: f.release.id },
      });
      const digest = candidateDigest(before);
      const result = await persistCandidateSnapshot(f.network, {
        source: {
          ...f.source,
          editionEvidence: [
            {
              text: f.source.title,
              provenance: { kind: "release-title", field: "title" },
            },
          ],
        },
        attributes: {
          id: before.id,
          providerId: before.providerId,
          title: before.title,
          ...PublicReleaseAttributesSchema.parse(before.attributes),
        },
        evaluation: z
          .object({
            accepted: z.boolean(),
            reasons: z.array(z.string()),
            qualityRank: z.number(),
            score: z.number(),
          })
          .parse(before.evaluation),
        searchedForMediaId: f.files.media.id,
      });
      expect(result).toBeNull();
      const after = await db.releaseCandidate.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after).toEqual(before);
      expect(candidateDigest(after)).toBe(digest);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);

test("current named original provenance blocks reviewed replacement even with rejected current quality", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const published = await f.files.published();
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    });
    await db.libraryAsset.update({
      where: { id: asset.id },
      data: {
        properties: {
          ...z.record(z.string(), z.json()).parse(asset.properties),
          title: "Example.Show.S01E01.Directors.Cut.480p.H264.ENG",
          quality: "unknown",
        },
      },
    });
    expect(await f.review()).toMatchObject({
      confirmationAllowed: false,
      edition: { reasons: ["edition_current_requires_classification"] },
    });
    await expect(f.select()).rejects.toMatchObject({
      code: "identity_protected",
    });
    expect(f.adds()).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("late current cut change is rechecked at the actual final add transaction", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const input = await f.select();
    const activities = createAcquisitionActivities(f.network);
    const reserved = await activities.reconcileMediaIntent(input);
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: z.uuid().parse(reserved.attemptId) },
    });
    await db.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "submitting" },
    });
    await db.libraryAsset.create({
      data: {
        path: `${f.files.roots.library}/prior.mkv`,
        sourcePath: "/downloads/Example.Show.S01E01.Extended.Cut.mkv",
        sizeBytes: 10,
        checksum: "a".repeat(64),
        properties: { title: "Example.Show.S01E01.Extended.Cut.480p" },
        owned: true,
        state: "published",
        ownershipEpoch: 0,
        editionRootId: f.series.id,
        coverage: { create: { mediaId: f.files.media.id, current: true } },
      },
    });
    let effects = 0;
    expect(
      await authorizedSubmission(f.network, attempt, () => {
        effects++;
        return Promise.resolve();
      }),
    ).toBe(false);
    expect(effects).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});
