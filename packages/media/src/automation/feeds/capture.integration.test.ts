import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { FeedCheckpointV1Schema } from "#shared/feeds/contract.ts";
import {
  beginNativeFeedPageV1,
  commitNativeFeedPageV1,
  feedInvocationId,
  readFeedPageReceiptV1,
} from "./checkpoint.ts";
import { readFeedSourceV1 } from "./source.ts";

const h = automationTestHarness();
const hash = "a".repeat(40);

async function fixture() {
  await h.fixture();
  const context = h.context();
  await context.db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true },
    update: { enabled: true, feedState: "unconfigured", lastFeedAt: null },
  });
  await context.db.reconciliationScan.deleteMany({
    where: {
      id: "feed-checkpoint-v1:knaben",
      kind: "provider_feed_checkpoint_v1",
    },
  });
  const sweepId = crypto.randomUUID();
  const invocationId = feedInvocationId(sweepId, null);
  const prepared = await beginNativeFeedPageV1(context, {
    providerId: "knaben",
    sweepId,
    invocationId,
  });
  return { context, sweepId, invocationId, prepared, page: nativePage };
}

function nativePage(ids: string[], more = false) {
  const wire = new KnabenProvider(() =>
    Promise.resolve(
      Response.json({
        hits: [
          ...ids.map((id) => ({
            id,
            title: `Synthetic Film.${id}.2020.Extended.Cut.1080p`,
            bytes: 1000,
            hash,
            seeders: 2,
            details: "https://knaben.org/fixture",
            magnetUrl: null,
          })),
          ...Array.from(
            { length: more ? 100 - ids.length : 0 },
            (_, index) => ({
              id: `unusable-${String(index)}`,
              title: "Synthetic unusable source",
              bytes: 1000,
              hash: null,
              seeders: 0,
              details: "https://knaben.org/fixture",
              magnetUrl: null,
            }),
          ),
        ],
      }),
    ),
  );
  return wire.recent({ page: 1 });
}

test("actual recent capture commits encrypted sources, match outbox, checkpoint and retained ACK together", async () => {
  const f = await fixture();
  const page = await f.page([crypto.randomUUID()]);
  const receipt = await commitNativeFeedPageV1(f.context, {
    prepared: f.prepared,
    page,
  });
  expect(receipt).toMatchObject({ page: 1, scanned: 1, nextCursor: "knaben" });
  expect(receipt.sourceIds).toHaveLength(1);
  const sourceId = receipt.sourceIds[0];
  if (sourceId === undefined) throw new Error("Actual feed source missing");
  expect(
    await readFeedSourceV1(f.context.db, f.context.cipher, sourceId),
  ).toEqual(page.candidates[0]);
  const source = await f.context.db.applicationEvent.findUniqueOrThrow({
    where: { id: sourceId },
  });
  expect(JSON.stringify(source.payload)).not.toContain("magnet:");
  const operation = await f.context.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `match-feed-source-v1:${sourceId}` },
    include: { outbox: true },
  });
  expect(operation.outbox).toMatchObject({
    kind: "match_provider_feed_source_v1",
    payload: {
      schemaVersion: 1,
      sourceId,
      operationId: operation.id,
      cursor: null,
    },
  });
  expect(
    await commitNativeFeedPageV1(f.context, { prepared: f.prepared, page }),
  ).toEqual(receipt);
  await f.context.db.mediaProvider.update({
    where: { id: "knaben" },
    data: { enabled: false },
  });
  expect(await readFeedPageReceiptV1(f.context.db, f.invocationId)).toEqual(
    receipt,
  );
  expect(await f.context.db.acquisitionAttempt.count()).toBe(0);
  expect(await f.context.db.libraryAsset.count()).toBe(0);
  await expect(
    f.context.db.applicationEvent.update({
      where: { id: sourceId },
      data: { payload: {} },
    }),
  ).rejects.toThrow("Provider feed source is immutable");
  await expect(
    f.context.db.reconciliationScan.update({
      where: { id: f.invocationId },
      data: { progress: {} },
    }),
  ).rejects.toThrow("Provider feed page receipt is immutable");
});

test("capture failure rolls back sources, match outbox and page progress", async () => {
  const f = await fixture();
  const page = await f.page([crypto.randomUUID()]);
  const first = page.candidates[0];
  if (first === undefined) throw new Error("Actual candidate missing");
  const before = await f.context.db.applicationEvent.count({
    where: { kind: "provider_feed_source_v1" },
  });
  const commands = await f.context.db.operation.count({
    where: { kind: "match_provider_feed_source_v1" },
  });
  await expect(
    commitNativeFeedPageV1(f.context, {
      prepared: f.prepared,
      page: {
        candidates: [first, { ...first, providerId: "privatehd" }],
        scanned: 2,
        nextPage: null,
      },
    }),
  ).rejects.toThrow("another provider");
  expect(
    await f.context.db.applicationEvent.count({
      where: { kind: "provider_feed_source_v1" },
    }),
  ).toBe(before);
  expect(
    await f.context.db.operation.count({
      where: { kind: "match_provider_feed_source_v1" },
    }),
  ).toBe(commands);
  expect(await readFeedPageReceiptV1(f.context.db, f.invocationId)).toBeNull();
  const checkpoint = await f.context.db.reconciliationScan.findUniqueOrThrow({
    where: { id: f.prepared.id },
  });
  expect(FeedCheckpointV1Schema.parse(checkpoint.progress)).toEqual(
    f.prepared.checkpoint,
  );
});

test("a full page with no usable hashes continues rather than marking an empty feed current", async () => {
  const f = await fixture();
  const receipt = await commitNativeFeedPageV1(f.context, {
    prepared: f.prepared,
    page: await f.page([], true),
  });
  expect(receipt).toMatchObject({ scanned: 100, sourceIds: [] });
  expect(receipt.nextCursor).toContain("feed-v1:");
  const row = await f.context.db.reconciliationScan.findUniqueOrThrow({
    where: { id: f.prepared.id },
  });
  expect(FeedCheckpointV1Schema.parse(row.progress)).toMatchObject({
    page: 2,
    completed: false,
    head: [],
  });
});

test("later cycles page until the retained head overlaps and reuse the original source and match command", async () => {
  const f = await fixture();
  const originalId = crypto.randomUUID();
  const original = await commitNativeFeedPageV1(f.context, {
    prepared: f.prepared,
    page: await f.page([originalId]),
  });
  const cycleId = crypto.randomUUID();
  const next = await beginNativeFeedPageV1(f.context, {
    providerId: "knaben",
    sweepId: cycleId,
    invocationId: feedInvocationId(cycleId, null),
  });
  const first = await commitNativeFeedPageV1(f.context, {
    prepared: next,
    page: await f.page([crypto.randomUUID()], true),
  });
  expect(first.nextCursor).toContain("feed-v1:");
  const continued = await beginNativeFeedPageV1(f.context, {
    providerId: "knaben",
    sweepId: cycleId,
    invocationId: feedInvocationId(cycleId, first.nextCursor),
  });
  const overlapping = await f.page([originalId], true);
  const last = await commitNativeFeedPageV1(f.context, {
    prepared: continued,
    page: { ...overlapping, nextPage: 3 },
  });
  expect(last).toMatchObject({
    page: 2,
    sourceIds: original.sourceIds,
    nextCursor: "knaben",
  });
  const originalSource = original.sourceIds[0];
  expect(
    await f.context.db.operation.count({
      where: {
        idempotencyKey: `match-feed-source-v1:${String(originalSource)}`,
      },
    }),
  ).toBe(1);
});
