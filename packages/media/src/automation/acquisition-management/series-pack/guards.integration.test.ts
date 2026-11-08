import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMultiSeasonSeriesFixture } from "#testing/series-workflow/multi-season-fixture.ts";
import { createSeriesPackPublicationFileFacet } from "#automation/files/series-pack/publication-facet.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";

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

async function stagedPack() {
  const f = await createMultiSeasonSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const selected = await f.acquired.reconcileMediaIntent(f.input);
  expect(selected.status, JSON.stringify(selected)).toBe("acquire");
  const input = {
    operationId: f.input.operationId,
    attemptId: z.uuid().parse(selected.attemptId),
  };
  expect(await f.acquired.submitMediaTorrent(input)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await f.acquired.observeMediaAcquisition(input)).toEqual({
    status: "ready",
    reason: "series_pack_publication_v1",
  });
  expect(await f.physical.inspectAndStageMedia(input)).toEqual({
    status: "staged",
  });
  return { f, input };
}

async function originalBytesUnchanged(
  f: Awaited<ReturnType<typeof createMultiSeasonSeriesFixture>>,
) {
  const expected = createHash("sha256").update(original).digest("hex");
  for (const target of [f.target, f.secondTarget]) {
    const actual = await readFile(target);
    expect(actual.byteLength).toBe(original.byteLength);
    expect(createHash("sha256").update(actual).digest("hex")).toBe(expected);
  }
  expect(
    await f.db.assetCoverage.count({
      where: { assetId: { in: f.originalAssetIds }, current: true },
    }),
  ).toBe(f.ids.length);
}

test("actual pack publication requires its prepared immutable intent before any forward syscall", async () => {
  const { f, input } = await stagedPack();
  expect(await f.physical.promoteMediaFiles(input)).toEqual({
    status: "blocked",
    reason: "publication_preparation_required",
  });
  expect(
    await f.db.mediaPublicationTransition.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
  await originalBytesUnchanged(f);
  expect(await f.physical.prepareSeriesPackPublication(input)).toEqual({
    status: "prepared",
  });
  await originalBytesUnchanged(f);
  expect(
    await f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: input.attemptId },
    }),
  ).toMatchObject({ outcome: null, outcomeHash: null });
  expect(await f.physical.promoteMediaFiles(input)).toEqual({
    status: "published",
  });
}, 60_000);

test("a foreign incoming coordinator protects both explicit Files phases", async () => {
  const { f, input } = await stagedPack();
  const foreign = { ...input, operationId: crypto.randomUUID() };
  expect(await f.physical.prepareSeriesPackPublication(foreign)).toEqual({
    status: "obsolete",
    reason: "acquisition_obsolete",
  });
  expect(await f.physical.promoteMediaFiles(foreign)).toEqual({
    status: "obsolete",
    reason: "acquisition_obsolete",
  });
  expect(
    await f.db.mediaPublicationTransition.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
  expect(await f.physical.prepareSeriesPackPublication(input)).toEqual({
    status: "prepared",
  });
  expect(await f.physical.promoteMediaFiles(foreign)).toEqual({
    status: "obsolete",
    reason: "acquisition_obsolete",
  });
  await originalBytesUnchanged(f);
}, 60_000);

test("the actual new Files facet retains the caller's 99-spent allowance through preparation", async () => {
  const { f, input } = await stagedPack();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  expect(
    await createSeriesPackPublicationFileFacet(f.files)(
      input,
      testPublicationExecution(),
      budget,
    ),
  ).toEqual({
    status: "blocked",
    reason: "archive_transition_reconciliation_required",
  });
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  expect(
    await f.db.mediaPublicationTransition.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
  await originalBytesUnchanged(f);
}, 60_000);
