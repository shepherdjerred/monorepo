import { expect } from "vitest";
import { z } from "zod";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";
import {
  completeMemberBatches,
  originalAllowance,
  providedAllowance,
} from "./publication-acceptance.ts";
import { createSeriesPackBoundedPublicationFileFacetV1 } from "#automation/files/series-pack/publication/facet.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  inspectPublicationRecords,
  publicationRecordNamespace,
} from "#filesystem/publication-proof/records.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";

/** All authority is produced by actual imports, queueing, assessment, acquisition and native staging. */
export async function stagedPerEpisodePublicationFixture(
  db: Database,
  directoryCreated: (directory: string) => void,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await createPerEpisodeMultiSeasonFixture(
    db,
    directoryCreated,
    bytes,
  );
  const selected = await originalAllowance(() =>
    f.acquired.reconcileMediaIntent(f.input),
  );
  expect(selected).toMatchObject({ status: "acquire" });
  const input = {
    operationId: f.input.operationId,
    attemptId: z.uuid().parse(selected.attemptId),
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
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const facet = createSeriesPackBoundedPublicationFileFacetV1(f.files);
  return { f, input, plan, facet };
}

export async function sealPerEpisodePublicationFixture(
  fixture: Awaited<ReturnType<typeof stagedPerEpisodePublicationFixture>>,
) {
  const { facet, input } = fixture;
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
  return fixture;
}

export async function compensatePerEpisodePublicationFixture(
  fixture: Awaited<ReturnType<typeof stagedPerEpisodePublicationFixture>>,
) {
  const { facet, input } = fixture;
  for (let batchIndex = 0; batchIndex < 6; batchIndex++) {
    const result = await providedAllowance((budget) =>
      facet.compensateSeriesPackMembersV1(
        { ...input, batchIndex },
        testPublicationExecution(),
        budget,
      ),
    );
    expect(result).toMatchObject({
      status: "compensated",
      nextBatchIndex: batchIndex === 5 ? null : batchIndex + 1,
    });
  }
  expect(
    await providedAllowance((budget) =>
      facet.sealSeriesPackCompensationV1(
        input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "compensated" });
}

export async function commitPerEpisodePublicationFixture(
  fixture: Awaited<ReturnType<typeof stagedPerEpisodePublicationFixture>>,
) {
  await sealPerEpisodePublicationFixture(fixture);
  const { facet, input } = fixture;
  await completeMemberBatches("published", (batchIndex) =>
    providedAllowance((budget) =>
      facet.publishSeriesPackMembersV1(
        { ...input, batchIndex },
        testPublicationExecution(),
        budget,
      ),
    ),
  );
  expect(
    await providedAllowance((budget) =>
      facet.sealSeriesPackPublicationOutcomeV1(
        input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "published" });
  return fixture;
}

export async function seriesPackPublicationEffectHashes(
  fixture: Awaited<ReturnType<typeof stagedPerEpisodePublicationFixture>>,
) {
  const hasIntent = await fixture.f.db.mediaPublicationTransition.count({
    where: { attemptId: fixture.input.attemptId },
  });
  if (hasIntent === 0 && (await missingPublicationAncestor(fixture))) return [];
  const observed = await inspectPublicationRecords(fixture.f.files.roots.tv, {
    transitionId: fixture.input.attemptId,
    continuationId: null,
    maxRecords: fixture.plan.reduce(
      (sum, entry) => sum + 12 + entry.previousSidecars.length * 8,
      0,
    ),
    maxRecordBytes:
      Buffer.byteLength(JSON.stringify(publicationReferences(fixture.plan))) *
        64 +
      262_144,
    checkpoint: () => Promise.resolve(),
  });
  return observed.records.map((row) => row.hash);
}

/** A pre-intent fixture has no namespace yet; prove the FIRST absence with existing verified parents. */
async function missingPublicationAncestor(
  fixture: Awaited<ReturnType<typeof stagedPerEpisodePublicationFixture>>,
) {
  let directory = fixture.f.files.roots.tv.control;
  if ((await realpath(directory)) !== directory)
    throw new FileOperationConflict("Fixture control root is unsafe");
  const relative = publicationRecordNamespace({
    transitionId: fixture.input.attemptId,
    continuationId: null,
  });
  for (const segment of relative.split("/")) {
    directory = path.join(directory, segment);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new FileOperationConflict(
          "Fixture publication ancestor is unsafe",
        );
    } catch (error) {
      if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
        throw error;
      const proof = new ContentProof();
      await proof.capture(directory, () => Promise.resolve());
      proof.seal();
      await proof.reviewAbsence(directory);
      return true;
    }
  }
  return false;
}
