import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  stagedPerEpisodePublicationFixture,
  sealPerEpisodePublicationFixture,
  compensatePerEpisodePublicationFixture,
  seriesPackPublicationEffectHashes as records,
} from "#testing/series-workflow/per-episode/publication-fixture.ts";
import {
  providedAllowance,
  assertWholePackPending,
} from "#testing/series-workflow/per-episode/publication-acceptance.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { SeriesPackPublicationOutcomeV3Schema } from "#shared/acquisition/series-pack-publication-v1.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { z } from "zod";

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

async function fixture() {
  return sealPerEpisodePublicationFixture(
    await stagedPerEpisodePublicationFixture(
      h.database(),
      (directory) => directories.push(directory),
      { original, upgrade },
    ),
  );
}
test("an actual moved four-member prefix survives database rollback and retries without repeating native effects", async () => {
  const f = await fixture();
  const checkpoint = f.f.files.checkpoint;
  let interrupted = false;
  f.f.files.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (
      !interrupted &&
      phase === "series-pack-publication-physical-before-commit"
    ) {
      interrupted = true;
      throw new Error("synthetic actual post-effect database rollback");
    }
  };
  await expect(
    providedAllowance((budget) =>
      f.facet.publishSeriesPackMembersV1(
        { ...f.input, batchIndex: 0 },
        testPublicationExecution(),
        budget,
      ),
    ),
  ).rejects.toThrow("post-effect database rollback");
  f.f.files.checkpoint = checkpoint;
  expect(
    await f.f.db.operation.count({
      where: {
        targetId: f.input.attemptId,
        kind: "publish_series_pack_members_v1",
      },
    }),
  ).toBe(0);
  const acknowledged = await records(f);
  expect(acknowledged.length).toBeGreaterThan(0);
  await assertWholePackPending(f.f, f.input.attemptId);
  expect(
    await providedAllowance((budget) =>
      f.facet.publishSeriesPackMembersV1(
        { ...f.input, batchIndex: 0 },
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toMatchObject({ status: "published", nextBatchIndex: 1 });
  expect(await records(f)).toEqual(acknowledged);
  await compensatePerEpisodePublicationFixture(f);
  const expected = createHash("sha256").update(original).digest("hex");
  for (const asset of await f.f.db.libraryAsset.findMany({
    where: { id: { in: f.f.originalAssetIds } },
  }))
    expect(await sha256File(workerFilePath(f.f.files, asset.path))).toBe(
      expected,
    );
}, 60_000);

test("last-leaf consent revocation stops the next physical batch and the real bounded inverse restores all original files", async () => {
  const f = await fixture();
  expect(
    await providedAllowance((budget) =>
      f.facet.publishSeriesPackMembersV1(
        { ...f.input, batchIndex: 0 },
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toMatchObject({ status: "published" });
  const last = f.f.ids.at(-1);
  if (last === undefined)
    throw new Error("Actual complete fixture lost its last leaf");
  await f.f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: last, edition: "default" } },
    data: { monitoring: false, generation: { increment: 1 } },
  });
  const before = await records(f);
  expect(
    await providedAllowance((budget) =>
      f.facet.publishSeriesPackMembersV1(
        { ...f.input, batchIndex: 1 },
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "obsolete", reason: "intent_obsolete" });
  expect(await records(f)).toEqual(before);
  await compensatePerEpisodePublicationFixture(f);
  const row = await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.input.attemptId },
  });
  const outcome = SeriesPackPublicationOutcomeV3Schema.parse(row.outcome);
  expect(outcome.kind).toBe("compensated");
  expect(outcome.seriesPackPublication.compensationReceipts).toHaveLength(6);
  expect(
    await f.f.db.acquisitionReservation.count({
      where: { attemptId: f.input.attemptId },
    }),
  ).toBe(0);
  expect(
    await f.f.db.assetCoverage.count({
      where: { assetId: { in: f.f.originalAssetIds }, current: true },
    }),
  ).toBe(24);
  const expected = createHash("sha256").update(original).digest("hex");
  for (const asset of await f.f.db.libraryAsset.findMany({
    where: { id: { in: f.f.originalAssetIds } },
  }))
    expect(await sha256File(workerFilePath(f.f.files, asset.path))).toBe(
      expected,
    );
  const rawOutcome = canonicalJson(z.json().parse(row.outcome));
  const prefix = await records(f);
  expect(
    await providedAllowance((budget) =>
      f.facet.sealSeriesPackCompensationV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "compensated" });
  expect(await records(f)).toEqual(prefix);
  const after = await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.input.attemptId },
  });
  expect(canonicalJson(z.json().parse(after.outcome))).toBe(rawOutcome);
}, 60_000);
