import { createHash } from "node:crypto";
import { stat, rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMultiSeasonSeriesFixture } from "#testing/series-workflow/multi-season-fixture.ts";
import {
  candidateDigest,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  loadProfile,
  currentRelease,
} from "#automation/acquisition-candidates.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { SeriesPackInterpretationEnvelopeV1Schema } from "#shared/acquisition/series-pack-v1.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import capturedProfiles from "#migration/fixtures/resolved-profiles.json";
import { importResolvedProfiles } from "#migration/profile-import.ts";
import { bytesPerMinute } from "#domain/resolved-quality.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { assertAndInstallActualCaptions } from "#testing/series-workflow/per-episode/caption-acceptance.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
let seasonUpgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
  seasonUpgrade = await movieVideoFixture(1920, undefined, {
    bitrateKbps: 1_280_000,
  });
  const captured = importResolvedProfiles(capturedProfiles).find(
    (entry) => entry.source === "sonarr",
  )?.profiles[0];
  const minimum = z
    .number()
    .positive()
    .parse(
      captured?.qualityDefinitions.find(
        (definition) => definition.quality.id === 3,
      )?.minSize,
    );
  expect(seasonUpgrade.byteLength).toBeGreaterThanOrEqual(
    bytesPerMinute(minimum) * 12,
  );
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** Call-through observation: the actual budget implementation still admits or rejects every real read. */
async function oneOriginalAllowance<T>(work: () => Promise<T>) {
  const consume = vi.spyOn(PublicationAuthorityReadBudget.prototype, "consume");
  try {
    const result = await work();
    expect(consume.mock.calls.length).toBeGreaterThan(0);
    expect(new Set(consume.mock.contexts).size).toBe(1);
    const total = consume.mock.calls.reduce((sum, [count]) => sum + count, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(100);
    return result;
  } finally {
    consume.mockRestore();
  }
}

test.each([2, 12])(
  "an explicit two-season pack with %i leaves per season completes actual Network, Files and both Plex parents under each original allowance",
  async (episodeCount) => {
    const actualUpgrade = episodeCount === 12 ? seasonUpgrade : upgrade;
    const f = await createMultiSeasonSeriesFixture(
      h.database(),
      (directory) => directories.push(directory),
      {
        original,
        upgrade: actualUpgrade,
        episodeCount,
        householdCaptions: true,
      },
    );
    const sourceBefore = await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: f.retainedReleaseId },
    });
    expect(
      parseSeriesSeasonSetV1(sourceBefore.title),
      "The synthetic catalog suffix must not introduce independent E-number evidence",
    ).toMatchObject({ status: "resolved" });
    const receiptsBefore = await f.db.mediaHandoffReceipt.findMany({
      where: { id: { in: [f.receiptId, f.second.receiptId] } },
      orderBy: { id: "asc" },
    });
    expect(receiptsBefore).toHaveLength(2);
    expect(sourceBefore.attributes).not.toMatchObject({
      identityConfidence: "exact",
    });
    expect(
      await f.db.acquisitionAttempt.count({
        where: { mediaIds: { hasSome: f.ids } },
      }),
    ).toBe(0);
    const reserved = await oneOriginalAllowance(() =>
      f.acquired.reconcileMediaIntent(f.input),
    );
    const diagnostic =
      reserved.status === "acquire"
        ? reserved
        : await actualPackEvaluation(f, reserved);
    expect(reserved, JSON.stringify(diagnostic)).toMatchObject({
      status: "acquire",
    });
    const input = {
      operationId: f.input.operationId,
      attemptId: z.uuid().parse(reserved.attemptId),
    };
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const identity = DefaultAcquisitionIdentitySchema.parse(
      attempt.identityEvidence,
    );
    expect(identity).toMatchObject({
      schemaVersion: 4,
      management: { schemaVersion: 3, policyScope: "episodes" },
      source: { seriesPackV1: { schemaVersion: 1 } },
    });
    expect(identity.coverage).toEqual([...f.ids].sort());
    const source = identity.source;
    if (!("seriesPackV1" in source))
      throw new Error("Actual new pack did not capture its derived parent");
    const parent = await f.db.operation.findUniqueOrThrow({
      where: { id: source.seriesPackV1.operationId },
    });
    expect(parent).toMatchObject({
      kind: "assess_series_pack_v1",
      status: "completed",
      userId: null,
      targetId: f.series.id,
    });
    expect(
      await f.db.outboxCommand.count({ where: { operationId: parent.id } }),
    ).toBe(0);
    const parentHash = identityHash(nativeJson(parent));
    expect(
      await oneOriginalAllowance(() => f.acquired.submitMediaTorrent(input)),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await oneOriginalAllowance(() =>
        f.acquired.observeMediaAcquisition(input),
      ),
    ).toEqual({ status: "ready", reason: "series_pack_publication_v1" });
    expect(
      await oneOriginalAllowance(() => f.physical.inspectAndStageMedia(input)),
    ).toEqual({ status: "staged" });
    expect(
      await oneOriginalAllowance(() =>
        f.physical.prepareSeriesPackPublication(input),
      ),
    ).toEqual({ status: "prepared" });
    expect(
      await oneOriginalAllowance(() => f.physical.promoteMediaFiles(input)),
    ).toEqual({ status: "published" });
    const staged = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const plan = FilePlanSchema.parse(staged.filePlan);
    expect(plan).toHaveLength(2);
    expect(
      plan.map((entry) => entry.mediaIds.length).sort((a, b) => a - b),
    ).toEqual([episodeCount, episodeCount]);
    expect(new Set(plan.flatMap((entry) => entry.mediaIds))).toEqual(
      new Set(f.ids),
    );
    expect(
      await oneOriginalAllowance(() => f.publication.publishMediaToPlex(input)),
    ).toEqual({ status: "available", reason: null });
    await assertAndInstallActualCaptions(f, input.attemptId, 2);
    await f.publication.finalizeMediaAcquisition(input);
    const current = await f.db.assetCoverage.findMany({
      where: { mediaId: { in: f.ids }, edition: "default", current: true },
      include: { asset: true },
    });
    expect(current).toHaveLength(episodeCount * 2);
    expect(new Set(current.map((row) => row.assetId)).size).toBe(2);
    const expected = createHash("sha256").update(actualUpgrade).digest("hex");
    const mapping = f.files.pathMapping;
    if (mapping === undefined)
      throw new Error("Fixture native path mapping missing");
    for (const asset of new Map(
      current.map((row) => [row.assetId, row.asset]),
    ).values()) {
      expect(asset).toMatchObject({
        state: "published",
        checksum: expected,
        sizeBytes: BigInt(actualUpgrade.byteLength),
      });
      const filename = mapping.local(asset.path);
      const info = await stat(filename);
      expect(info.size).toBe(actualUpgrade.byteLength);
      expect(await sha256File(filename)).toBe(expected);
    }
    const pointers = await f.db.plexBindingCurrent.findMany({
      where: { mediaId: { in: f.ids }, edition: "default" },
      include: { evidence: true },
    });
    expect(pointers).toHaveLength(episodeCount * 2);
    expect(pointers.every((row) => row.evidence !== null)).toBe(true);
    expect(
      new Set(
        pointers.map(
          (row) =>
            z
              .object({
                hierarchy: z.object({
                  season: z.object({ ratingKey: z.string() }),
                }),
              })
              .parse(row.evidence?.evidence).hierarchy.season.ratingKey,
        ),
      ).size,
    ).toBe(2);
    const completed = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    expect(completed).toMatchObject({
      state: "completed",
      sponsorRequestId: null,
    });
    expect(
      await f.db.mediaRequest.count({
        where: { mediaId: { in: [f.series.id, ...f.ids] } },
      }),
    ).toBe(0);
    const sourceAfter = await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: f.retainedReleaseId },
    });
    expect(candidateDigest(sourceAfter)).toBe(candidateDigest(sourceBefore));
    expect(sourceAfter.attributes).toEqual(sourceBefore.attributes);
    expect(sourceAfter.encryptedSource).toBe(sourceBefore.encryptedSource);
    expect(
      await f.db.mediaHandoffReceipt.findMany({
        where: { id: { in: [f.receiptId, f.second.receiptId] } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(receiptsBefore);
    expect(
      identityHash(
        nativeJson(
          await f.db.operation.findUniqueOrThrow({ where: { id: parent.id } }),
        ),
      ),
    ).toBe(parentHash);
    expect(f.wire.additions()).toBe(1);
  },
  60_000,
);

/** Only failed-test diagnostics: independently evaluate the actual producer's retained parent and current policy. */
async function actualPackEvaluation(
  f: Awaited<ReturnType<typeof createMultiSeasonSeriesFixture>>,
  result: unknown,
) {
  const profile = await loadProfile(f.db, f.input.mediaId);
  if (profile === null)
    throw new Error("Actual pack diagnostic profile missing");
  const current = await currentRelease(f.context, f.input.mediaId);
  const release = await f.db.releaseCandidate.findUniqueOrThrow({
    where: { id: f.retainedReleaseId },
  });
  const parents = await f.db.operation.findMany({
    where: { kind: "assess_series_pack_v1", targetId: f.series.id },
    select: { payload: true },
  });
  return {
    result,
    // This exposes an early syntax rejection even when no derived assessment exists.
    sourceSyntax: parseSeriesSeasonSetV1(release.title),
    evaluations: parents.map((row) => {
      const value = SeriesPackInterpretationEnvelopeV1Schema.parse(
        row.payload,
      ).interpretation;
      return chooseUpgrade({
        candidate: {
          id: release.id,
          providerId: release.providerId,
          title: release.title,
          ...value.attributes,
        },
        current,
        profile,
        mediaIds: [f.input.mediaId],
      });
    }),
  };
}
