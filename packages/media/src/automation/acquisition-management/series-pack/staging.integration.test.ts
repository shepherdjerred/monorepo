import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createPerEpisodeMultiSeasonFixture } from "#testing/series-workflow/per-episode/fixture.ts";
import { createSeriesPackStagingFileFacetV1 } from "#automation/files/series-pack/staging/facet.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { readSeriesPackStagingReceiptV1 } from "#infrastructure/acquisition-identity/series-pack/staging/receipts.ts";
import { completeSeriesPackStagingPartitionV1 } from "#infrastructure/acquisition-identity/series-pack/staging/seal.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import { readSeriesPackStagingSealV1 } from "#infrastructure/acquisition-identity/series-pack/staging/seal.ts";
import { assertSeriesPackStagingObservationCurrentV1 } from "#infrastructure/acquisition-identity/series-pack/staging/observation.ts";
import type { SeriesPackStagingScopeV1 } from "#shared/acquisition/series-pack-staging-v1.ts";

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
async function oneAllowance<T>(work: () => Promise<T>) {
  const consume = vi.spyOn(PublicationAuthorityReadBudget.prototype, "consume");
  try {
    const result = await work();
    expect(new Set(consume.mock.contexts).size).toBe(1);
    const total = consume.mock.calls.reduce((sum, [count]) => sum + count, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(100);
    return result;
  } finally {
    consume.mockRestore();
  }
}
async function readyPack() {
  const f = await createPerEpisodeMultiSeasonFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const reserved = await oneAllowance(() =>
    f.acquired.reconcileMediaIntent(f.input),
  );
  expect(reserved).toMatchObject({ status: "acquire" });
  const input = {
    operationId: f.input.operationId,
    attemptId: z.uuid().parse(reserved.attemptId),
  };
  expect(
    await oneAllowance(() => f.acquired.submitMediaTorrent(input)),
  ).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(
    await oneAllowance(() => f.acquired.observeMediaAcquisition(input)),
  ).toEqual({
    status: "ready",
    reason: "series_pack_publication_v1",
  });
  return { f, input };
}

test("the new batch facet retains a99-spent caller allowance and cannot start member effects", async () => {
  const { f, input } = await readyPack();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  expect(
    await createSeriesPackStagingFileFacetV1(f.files).stageSeriesPackMembersV1(
      { ...input, batchIndex: 0 },
      testPublicationExecution(),
      budget,
    ),
  ).toEqual({
    status: "blocked",
    reason: "archive_transition_reconciliation_required",
  });
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  expect(
    await f.db.operation.count({
      where: {
        kind: "stage_series_pack_members_v1",
        targetId: input.attemptId,
      },
    }),
  ).toBe(0);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    }),
  ).toMatchObject({ filePlan: null });
  expect(
    await f.db.assetCoverage.count({
      where: { assetId: { in: f.originalAssetIds }, current: true },
    }),
  ).toBe(24);
}, 60_000);

test("a later leaf revocation stops the next batch while a completed batch is only an exact immutable ACK", async () => {
  const { f, input } = await readyPack();
  const first = await f.physical.stageSeriesPackMembersV1({
    ...input,
    batchIndex: 0,
  });
  expect(first).toMatchObject({ status: "staged", nextBatchIndex: 1 });
  if (first.status !== "staged")
    throw new Error("Actual first native batch did not stage");
  const row = await f.db.operation.findUniqueOrThrow({
    where: { id: first.receiptId },
  });
  const receipt = readSeriesPackStagingReceiptV1(row);
  expect(receipt.prepared.entries).toHaveLength(4);
  expect(receipt.result?.completion.journals).toHaveLength(4);
  expect(
    receipt.prepared.entries.every(
      (entry) =>
        entry.mediaIds.length === 1 && entry.embeddedSubtitles.length === 2,
    ),
  ).toBe(true);
  const completedHash = identityHash({
    payload: row.payload,
    result: row.result,
  });
  expect(() =>
    completeSeriesPackStagingPartitionV1(receipt.prepared.scope, []),
  ).toThrow("every exact completed member batch");
  expect(() =>
    completeSeriesPackStagingPartitionV1(receipt.prepared.scope, [
      receipt,
      receipt,
    ]),
  ).toThrow("every exact completed member batch");
  await expect(
    f.db.operation.update({ where: { id: row.id }, data: { payload: {} } }),
  ).rejects.toThrow("immutable");
  const later = f.ids.find(
    (id) =>
      !receipt.prepared.entries.some((entry) => entry.mediaIds.includes(id)),
  );
  const laterId = z.uuid().parse(later);
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: laterId, edition: "default" } },
    data: {
      monitoring: false,
      generation: { increment: 1 },
      version: { increment: 1 },
    },
  });
  expect(
    await f.physical.stageSeriesPackMembersV1({ ...input, batchIndex: 1 }),
  ).toEqual({ status: "obsolete", reason: "intent_obsolete" });
  expect(
    await f.physical.stageSeriesPackMembersV1({ ...input, batchIndex: 0 }),
  ).toEqual(first);
  const after = await f.db.operation.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(identityHash({ payload: after.payload, result: after.result })).toBe(
    completedHash,
  );
  expect(
    await f.db.operation.count({
      where: {
        kind: "stage_series_pack_members_v1",
        targetId: input.attemptId,
      },
    }),
  ).toBe(1);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    }),
  ).toMatchObject({ filePlan: null });
  expect(
    await f.db.assetCoverage.count({
      where: { assetId: { in: f.originalAssetIds }, current: true },
    }),
  ).toBe(24);
  expect(
    await f.db.mediaPublicationTransition.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
}, 60_000);

const ReadyBody = z.object({
  torrent: z.record(z.string(), z.json()),
  files: z.array(z.record(z.string(), z.json())).min(1),
});

function assertCriticalObservationProtection(scope: SeriesPackStagingScopeV1) {
  const originalObservation: unknown = JSON.parse(scope.observationRaw);
  expect(() =>
    assertSeriesPackStagingObservationCurrentV1(scope, originalObservation),
  ).not.toThrow();
  const mutations: {
    name: string;
    change: (body: z.infer<typeof ReadyBody>) => void;
  }[] = [
    {
      name: "filename",
      change: (body) => {
        const file = body.files[0];
        if (file === undefined) throw new Error("Missing actual native member");
        file["name"] = "foreign.S01E01.mkv";
      },
    },
    {
      name: "member size",
      change: (body) => {
        const file = body.files[0];
        if (file === undefined) throw new Error("Missing actual native member");
        file["size"] = z.number().parse(file["size"]) + 1;
      },
    },
    {
      name: "ownership tags",
      change: (body) => {
        body.torrent["tags"] = "foreign-owner";
      },
    },
    {
      name: "save path",
      change: (body) => {
        body.torrent["save_path"] = "/downloads/foreign";
      },
    },
    {
      name: "content path",
      change: (body) => {
        body.torrent["content_path"] = "/downloads/foreign/content";
      },
    },
    {
      name: "category",
      change: (body) => {
        body.torrent["category"] = "foreign";
      },
    },
    {
      name: "native policy",
      change: (body) => {
        body.torrent["ratio_limit"] = 1;
      },
    },
    {
      name: "complete native size",
      change: (body) => {
        body.torrent["size"] = z.number().parse(body.torrent["size"]) + 1;
      },
    },
    {
      name: "torrent hash",
      change: (body) => {
        const hash = z.string().parse(body.torrent["hash"]);
        body.torrent["hash"] =
          `${hash.startsWith("a") ? "b" : "a"}${hash.slice(1)}`;
      },
    },
  ];
  for (const mutation of mutations) {
    const current = ReadyBody.parse(structuredClone(originalObservation));
    mutation.change(current);
    expect(
      () => assertSeriesPackStagingObservationCurrentV1(scope, current),
      mutation.name,
    ).toThrow("series_pack_staging_scope_changed");
  }
}

test("six actual member batches and the separate seal stage24 files and48 real captions despite fresh seeding metrics, under each original allowance", async () => {
  const { f, input } = await readyPack();
  let batchIndex = 0;
  const receiptIds: string[] = [];
  for (let count = 0; count < 6; count++) {
    const result = await oneAllowance(() =>
      f.physical.stageSeriesPackMembersV1({ ...input, batchIndex }),
    );
    expect(result).toMatchObject({ status: "staged" });
    if (result.status !== "staged")
      throw new Error("Actual member batch did not stage");
    receiptIds.push(result.receiptId);
    expect(result.nextBatchIndex).toBe(count === 5 ? null : count + 1);
    if (count === 0) {
      f.wire.control.ratio = 1.25;
      f.wire.control.seedingTime = 123;
      f.wire.control.state = "stalledUP";
      expect(
        await oneAllowance(() => f.acquired.observeMediaAcquisition(input)),
      ).toEqual({ status: "ready", reason: "series_pack_publication_v1" });
    }
    if (result.nextBatchIndex !== null) batchIndex = result.nextBatchIndex;
  }
  const parents = await f.db.operation.findMany({
    where: { id: { in: receiptIds } },
    orderBy: { id: "asc" },
  });
  expect(parents).toHaveLength(6);
  const receipts = parents.map((row) => readSeriesPackStagingReceiptV1(row));
  const first = receipts.find((receipt) => receipt.prepared.batchIndex === 0);
  if (first === undefined) throw new Error("Actual first ready parent missing");
  const originalHash = identityHash(
    parents.map((row) => ({ payload: row.payload, result: row.result })),
  );
  expect(
    receipts.every(
      (receipt) => receipt.prepared.scopeHash === first.prepared.scopeHash,
    ),
  ).toBe(true);
  assertCriticalObservationProtection(first.prepared.scope);
  f.wire.control.ratio = 2.5;
  f.wire.control.seedingTime = 456;
  f.wire.control.state = "pausedUP";
  expect(
    await oneAllowance(() => f.acquired.observeMediaAcquisition(input)),
  ).toEqual({ status: "ready", reason: "series_pack_publication_v1" });
  expect(
    await oneAllowance(() => f.physical.sealSeriesPackStagingV1(input)),
  ).toEqual({ status: "staged" });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { torrent: true },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  expect(attempt.state).toBe("validating");
  expect(plan).toHaveLength(24);
  expect(
    plan.every(
      (entry) =>
        entry.mediaIds.length === 1 && entry.embeddedSubtitles.length === 2,
    ),
  ).toBe(true);
  expect(new Set(plan.map((entry) => entry.assetId)).size).toBe(24);
  expect(new Set(plan.flatMap((entry) => entry.mediaIds))).toEqual(
    new Set(f.ids),
  );
  const captions = plan.flatMap((entry) => entry.embeddedSubtitles);
  expect(captions).toHaveLength(48);
  for (const subtitle of captions) {
    const bytes = await readFile(
      path.join(f.files.roots.tv.control, subtitle.relativePath),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      subtitle.checksum,
    );
    expect(
      validateSubtitle({
        bytes,
        filename: `embedded.${subtitle.format}`,
        requireSimplified: subtitle.language === "zh-Hans",
        provenanceText: "Actual current native episode track",
      }).text.length,
    ).toBeGreaterThan(0);
  }
  const sealRow = await f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `series-pack-staging-seal-v1:${input.attemptId}` },
  });
  const sealed = readSeriesPackStagingSealV1(sealRow);
  expect(sealed.seal.filePlanHash).toBe(identityHash(attempt.filePlan));
  expect(sealed.seal.scope.observationRaw).toBe(
    first.prepared.scope.observationRaw,
  );
  expect(sealed.seal.scope.observationHash).toBe(
    first.prepared.scope.observationHash,
  );
  expect(identityHash(attempt.torrent?.observation)).not.toBe(
    first.prepared.scope.observationHash,
  );
  const after = await f.db.operation.findMany({
    where: { id: { in: receiptIds } },
    orderBy: { id: "asc" },
  });
  expect(
    identityHash(
      after.map((row) => ({ payload: row.payload, result: row.result })),
    ),
  ).toBe(originalHash);
  expect(
    await f.db.libraryAsset.count({
      where: { id: { in: plan.map((entry) => entry.assetId) } },
    }),
  ).toBe(0);
  expect(
    await f.db.subtitleAsset.count({
      where: { assetId: { in: plan.map((entry) => entry.assetId) } },
    }),
  ).toBe(0);
  expect(
    await f.db.assetCoverage.count({
      where: { assetId: { in: f.originalAssetIds }, current: true },
    }),
  ).toBe(24);
  expect(
    await f.db.mediaPublicationTransition.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
  expect(f.wire.additions()).toBe(1);
}, 60_000);
