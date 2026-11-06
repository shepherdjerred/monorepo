import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createPerEpisodeMultiSeasonFixture } from "#testing/series-workflow/per-episode/fixture.ts";
import { assertAndInstallActualCaptions } from "#testing/series-workflow/per-episode/caption-acceptance.ts";
import {
  originalAllowance,
  providedAllowance,
  completeMemberBatches,
  assertWholePackPending,
} from "#testing/series-workflow/per-episode/publication-acceptance.ts";
import { createSeriesPackBoundedPublicationFileFacetV1 } from "#automation/files/series-pack/publication/facet.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { SeriesPackPublicationOutcomeV3Schema } from "#shared/acquisition/series-pack-publication-v1.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("twenty-four real episode files publish as one complete pack and install forty-eight requested captions under each original Activity allowance", async () => {
  const f = await createPerEpisodeMultiSeasonFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const reserved = await originalAllowance(() =>
    f.acquired.reconcileMediaIntent(f.input),
  );
  expect(reserved).toMatchObject({ status: "acquire" });
  const input = {
    operationId: f.input.operationId,
    attemptId: z.uuid().parse(reserved.attemptId),
  };
  expect(
    await originalAllowance(() => f.acquired.submitMediaTorrent(input)),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await originalAllowance(() => f.acquired.observeMediaAcquisition(input)),
  ).toMatchObject({ status: "ready" });
  await completeMemberBatches("staged", (batchIndex) =>
    originalAllowance(() =>
      f.physical.stageSeriesPackMembersV1({ ...input, batchIndex }),
    ),
  );
  expect(
    await originalAllowance(() => f.physical.sealSeriesPackStagingV1(input)),
  ).toEqual({ status: "staged" });
  const staged = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const plan = FilePlanSchema.parse(staged.filePlan);
  expect(plan).toHaveLength(24);
  expect(
    plan.every(
      (entry) =>
        entry.mediaIds.length === 1 && entry.embeddedSubtitles.length === 2,
    ),
  ).toBe(true);
  const facet = createSeriesPackBoundedPublicationFileFacetV1(f.files);
  await completeMemberBatches("prepared", (batchIndex) =>
    providedAllowance((budget) =>
      facet.prepareSeriesPackMembersPublicationV1(
        { ...input, batchIndex },
        testPublicationExecution(),
        budget,
      ),
    ),
  );
  expect(
    await providedAllowance((budget) =>
      facet.sealSeriesPackPublicationIntentV1(
        input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "prepared" });
  await assertWholePackPending(f, input.attemptId);
  await completeMemberBatches("published", async (batchIndex) => {
    const result = await providedAllowance((budget) =>
      facet.publishSeriesPackMembersV1(
        { ...input, batchIndex },
        testPublicationExecution(),
        budget,
      ),
    );
    await assertWholePackPending(f, input.attemptId);
    return result;
  });
  expect(
    await providedAllowance((budget) =>
      facet.sealSeriesPackPublicationOutcomeV1(
        input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "published" });
  const parent = await f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: input.attemptId },
  });
  const outcome = SeriesPackPublicationOutcomeV3Schema.parse(parent.outcome);
  expect(outcome.entries).toHaveLength(24);
  expect(outcome.seriesPackPublication.publishReceipts).toHaveLength(6);
  expect(
    await originalAllowance(() => f.publication.publishMediaToPlex(input)),
  ).toEqual({ status: "available", reason: null });
  await assertAndInstallActualCaptions(f, input.attemptId);
  await f.publication.finalizeMediaAcquisition(input);
  const covered = await f.db.assetCoverage.findMany({
    where: { mediaId: { in: f.ids }, edition: "default", current: true },
    include: { asset: true },
  });
  expect(covered).toHaveLength(24);
  expect(new Set(covered.map((row) => row.assetId)).size).toBe(24);
  const checksum = createHash("sha256").update(upgrade).digest("hex");
  for (const row of covered) {
    expect(row.asset).toMatchObject({
      state: "published",
      checksum,
      sizeBytes: BigInt(upgrade.byteLength),
    });
    expect(await sha256File(workerFilePath(f.files, row.asset.path))).toBe(
      checksum,
    );
  }
  const pointers = await f.db.plexBindingCurrent.findMany({
    where: { mediaId: { in: f.ids }, edition: "default" },
    include: { evidence: true },
  });
  expect(pointers).toHaveLength(24);
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
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    }),
  ).toMatchObject({ state: "completed", sponsorRequestId: null });
  expect(f.wire.additions()).toBe(1);
}, 60_000);
