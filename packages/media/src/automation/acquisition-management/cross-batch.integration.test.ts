import { rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import { extendManagedSeriesBatch } from "#testing/series-workflow/cross-batch-fixture.ts";
import { readLibrarySeriesManagement } from "#infrastructure/acquisition-identity/library-management.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
let merged: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
  merged = await movieVideoFixture(1920, undefined, { bitrateKbps: 320_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each([true, false])(
  "a complete pack spans two actual library adoption batches with series policy=%s",
  async (seriesPolicy) => {
    const f = await createManagedSeriesFixture(
      h.database(),
      (directory) => directories.push(directory),
      {
        original,
        upgrade,
        ...(seriesPolicy ? { monitorSeries: { includeSpecials: false } } : {}),
      },
    );
    const approval = await f.db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.receiptId },
    });
    const second = await extendManagedSeriesBatch(f, upgrade);
    expect(second.receiptId).not.toBe(f.receiptId);
    const reserved = await second.acquired.reconcileMediaIntent(f.input);
    expect(reserved, JSON.stringify(reserved)).toMatchObject({
      status: "acquire",
    });
    const input = {
      operationId: f.input.operationId,
      attemptId: z.uuid().parse(reserved.attemptId),
    };
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    expect(new Set(attempt.mediaIds)).toEqual(new Set(second.ids));
    expect(attempt.identityEvidence).toMatchObject({
      schemaVersion: 4,
      management: seriesPolicy
        ? { schemaVersion: 2, policyScope: "series", receiptId: f.receiptId }
        : {
            schemaVersion: 3,
            policyScope: "episodes",
            approvals: [f.receiptId, second.receiptId]
              .sort()
              .map((receiptId) => ({ receiptId })),
          },
    });
    expect(await second.acquired.submitMediaTorrent(input)).toEqual({
      status: "submitted",
      reason: null,
    });
    expect(await second.acquired.observeMediaAcquisition(input)).toEqual({
      status: "ready",
      reason: null,
    });
    expect(await f.physical.inspectAndStageMedia(input)).toEqual({
      status: "staged",
    });
    expect(await f.physical.promoteMediaFiles(input)).toEqual({
      status: "published",
    });
    expect(await second.publication.publishMediaToPlex(input)).toEqual({
      status: "available",
      reason: null,
    });
    await second.publication.finalizeMediaAcquisition(input);
    const coverage = await f.db.assetCoverage.findMany({
      where: { mediaId: { in: second.ids }, edition: "default", current: true },
      include: { asset: true },
    });
    expect(coverage).toHaveLength(4);
    expect(new Set(coverage.map((row) => row.assetId)).size).toBe(2);
    const mapping = f.files.pathMapping;
    if (mapping === undefined) throw new Error("Fixture path mapping missing");
    for (const row of coverage)
      expect(mapping.local(row.asset.path)).toBe(
        f.ids.includes(row.mediaId) ? f.target : second.target,
      );
    for (const published of new Map(
      coverage.map((row) => [row.assetId, row.asset]),
    ).values()) {
      expect(published.state).toBe("published");
      expect(published.sizeBytes).toBe(BigInt(upgrade.byteLength));
      expect(
        createHash("sha256")
          .update(await readFile(mapping.local(published.path)))
          .digest("hex"),
      ).toBe(createHash("sha256").update(upgrade).digest("hex"));
    }
    expect(
      await f.db.libraryAsset.findMany({
        where: { id: { in: [f.asset.id, second.asset.id] } },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: f.asset.id, state: "superseded" }),
        expect.objectContaining({ id: second.asset.id, state: "superseded" }),
      ]),
    );
    expect(
      await f.db.mediaRequest.count({
        where: { mediaId: { in: [f.series.id, ...second.ids] } },
      }),
    ).toBe(0);
    expect(second.wire.additions()).toBe(1);
    expect(
      await f.db.mediaHandoffReceipt.findUniqueOrThrow({
        where: { id: f.receiptId },
      }),
    ).toEqual(approval);
  },
  60_000,
);

async function readPackPolicy(
  second: Awaited<ReturnType<typeof extendManagedSeriesBatch>>,
  budget = new PublicationAuthorityReadBudget(),
) {
  const invocation = {
    freshness: second.context.plexBindingExecution(),
    access: await second.context.plexAccess("show"),
    budget,
  };
  return second.context.db.$transaction(async (tx) => {
    await lockAcquisitionMedia(tx, second.ids);
    expect(await lockRuntimeAuthority(tx, 0)).toBe(true);
    return readLibrarySeriesManagement(
      tx,
      { mediaIds: second.ids, epoch: 0, access: invocation.access },
      invocation,
    );
  });
}

test("combined existing-episode approvals grant no permission for an unapproved later episode", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const second = await extendManagedSeriesBatch(f, upgrade);
  expect(
    await f.db.mediaHandoffReceipt.count({
      where: { id: { in: [f.receiptId, second.receiptId] } },
    }),
  ).toBe(2);
  expect(
    await f.db.mediaIntent.count({
      where: {
        mediaId: { in: second.ids },
        desiredPresence: true,
        libraryMonitoring: true,
        monitoring: true,
      },
    }),
  ).toBe(4);
  expect(await readPackPolicy(second)).toMatchObject({
    proof: { schemaVersion: 3, policyScope: "episodes" },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Unapproved later episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 5,
    },
  });
  await f.db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(future.id)], { createMissing: true }),
  );
  expect(
    await readPackPolicy({ ...second, ids: [...second.ids, future.id] }),
  ).toBeNull();
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: defaultScope(future.id) },
    }),
  ).toMatchObject({
    desiredPresence: false,
    monitoring: false,
    libraryMonitoring: false,
    automationEpoch: -1,
    generation: 0,
  });
  expect(second.wire.additions()).toBe(0);
}, 60_000);

test("all original batch approvals consume the caller's one allowance without restarting it for the next source", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const second = await extendManagedSeriesBatch(f, upgrade);
  const exact = new PublicationAuthorityReadBudget();
  exact.consume(90);
  expect(await readPackPolicy(second, exact)).toMatchObject({
    proof: { schemaVersion: 3 },
  });
  expect(exact.take).toBe(1);
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(91);
  await expect(readPackPolicy(second, exhausted)).rejects.toThrow(
    "100 total queried records",
  );
  expect(second.wire.additions()).toBe(0);
}, 60_000);

test.each([true, false])(
  "a revoked later-batch episode protects the complete pack with series policy=%s",
  async (seriesPolicy) => {
    const f = await createManagedSeriesFixture(
      h.database(),
      (directory) => directories.push(directory),
      {
        original,
        upgrade,
        ...(seriesPolicy ? { monitorSeries: { includeSpecials: false } } : {}),
      },
    );
    const second = await extendManagedSeriesBatch(f, upgrade);
    expect(await readPackPolicy(second)).not.toBeNull();
    await f.db.mediaIntent.update({
      where: {
        mediaId_edition: {
          mediaId: z.uuid().parse(second.episodes[0]?.id),
          edition: "default",
        },
      },
      data: {
        monitoring: false,
        generation: { increment: 1 },
        version: { increment: 1 },
      },
    });
    await expect(readPackPolicy(second)).rejects.toMatchObject({
      code: "library_management_unconfirmed",
    });
    expect(second.wire.additions()).toBe(0);
  },
  60_000,
);

test("a pack member cannot merge separately owned file groups or rewrite either adopted path", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    {
      original,
      upgrade: merged,
      monitorSeries: { includeSpecials: false },
    },
  );
  const second = await extendManagedSeriesBatch(f, merged, "merged");
  const reserved = await second.acquired.reconcileMediaIntent(f.input);
  expect(reserved.status).toBe("acquire");
  const input = {
    operationId: f.input.operationId,
    attemptId: z.uuid().parse(reserved.attemptId),
  };
  expect(await second.acquired.submitMediaTorrent(input)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await second.acquired.observeMediaAcquisition(input)).toEqual({
    status: "ready",
    reason: null,
  });
  expect(await f.physical.inspectAndStageMedia(input)).toEqual({
    status: "blocked",
    reason: "upgrade_coverage_conflict",
  });
  for (const target of [f.target, second.target])
    expect(
      createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
    ).toBe(createHash("sha256").update(original).digest("hex"));
  expect(
    await f.db.assetCoverage.count({
      where: { assetId: { in: [f.asset.id, second.asset.id] }, current: true },
    }),
  ).toBe(4);
  expect(second.wire.additions()).toBe(1);
}, 60_000);
