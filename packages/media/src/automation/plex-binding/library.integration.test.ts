import { afterAll, beforeAll, expect, test } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { Prisma } from "#generated/prisma/client.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { libraryBindingFixture } from "./library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "./library.ts";
import { libraryTvBindingFixture } from "./library-tv.test-fixture.ts";
import { queueLibraryPlexBinding } from "#infrastructure/plex-binding/library/queue.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("a changed movie identity cannot relabel the adopted physical owner", async () => {
  const f = await fixture("directors_cut");
  await cluster.database.mediaItem.update({
    where: { id: f.network.media.id },
    data: {
      tmdbId: Number(f.network.media.tmdbId) + 1,
      version: { increment: 1 },
    },
  });
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      f.input,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "superseded" });
  expect(f.calls).toEqual([]);
  expect(
    await cluster.database.plexBindingCurrent.count({
      where: { mediaId: f.network.media.id },
    }),
  ).toBe(0);
});

test("a missing named-cut label stays protected and cannot install a default binding", async () => {
  const f = await fixture("directors_cut");
  const { editionTitle: _label, ...unmarked } = f.item();
  f.setItem(unmarked);
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      f.input,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "protected", reason: "metadata_changed" });
  expect(
    await cluster.database.plexBindingCurrent.count({
      where: { mediaId: f.network.media.id },
    }),
  ).toBe(0);
});

test("an exhausted original verification budget makes no Plex request", async () => {
  const f = await fixture("default");
  const execution = testPlexBindingExecution();
  const elapsed = 60_001;
  const expired = {
    ...execution,
    observed: {
      wall: execution.observed.wall - elapsed,
      monotonic: execution.observed.monotonic - elapsed,
    },
    expiresAtMs: execution.expiresAtMs - elapsed,
  };
  expect(await verifyLibraryPlexBinding(f.context, f.input, expired)).toEqual({
    status: "protected",
    reason: "verification_expired",
  });
  expect(f.calls).toEqual([]);
});

test("a writer lease that expires during the two Plex passes prevents all binding effects", async () => {
  const f = await fixture("default");
  const read = f.context.plex.metadata.bind(f.context.plex);
  f.context.plex.metadata = async (...args) => {
    const item = await read(...args);
    await cluster.database.legacyWriterLease.update({
      where: { id: "singleton" },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    return item;
  };
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      f.input,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "superseded" });
  expect(
    await cluster.database.plexBindingCurrent.count({
      where: { mediaId: f.network.media.id },
    }),
  ).toBe(0);
  expect(
    await cluster.database.plexAssociationEvidence.count({
      where: { assetId: f.asset.id },
    }),
  ).toBe(0);
});

async function fixture(
  edition: (typeof MovieEditionKeySchema.options)[number],
) {
  const f = await libraryBindingFixture(
    cluster.database,
    edition,
    (directory) => directories.push(directory),
  );
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
    include: { outbox: true },
  });
  const input = LibraryPlexBindingInputV1Schema.parse(operation.payload);
  expect(operation.outbox).toMatchObject({
    kind: input.kind,
    dispatchedAt: null,
    payload: input,
  });
  return { ...f, input };
}

test.each(MovieEditionKeySchema.options)(
  "adopted %s gets a serving binding without request or acquisition history",
  async (edition) => {
    const f = await fixture(edition);
    const item = structuredClone(f.item());
    expect(
      await verifyLibraryPlexBinding(
        f.context,
        f.input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    const binding = await cluster.database.plexBindingCurrent.findUniqueOrThrow(
      {
        where: { mediaId_edition: { mediaId: f.network.media.id, edition } },
        include: { evidence: true },
      },
    );
    expect(binding.evidence).toMatchObject({
      assetId: f.asset.id,
      edition,
      evidence: {
        schemaVersion: 2,
        scope: { mediaId: f.network.media.id, edition },
        item: { ratingKey: f.item().ratingKey },
      },
    });
    expect(
      f.calls.filter((call) => call === "/library/sections/1/all"),
    ).toHaveLength(2);
    expect(f.item()).toEqual(item);
    expect(await readFile(f.target)).toEqual(Buffer.from(f.bytes));
    expect(
      await cluster.database.acquisitionAttempt.count({
        where: { mediaIds: { has: f.network.media.id } },
      }),
    ).toBe(0);
    expect(
      await cluster.database.mediaRequest.count({
        where: { mediaId: f.network.media.id, userId: f.network.actor.id },
      }),
    ).toBe(0);
    const count = f.calls.length;
    await cluster.database.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        mode: "observe",
        ownershipConfirmed: false,
        version: { increment: 1 },
      },
    });
    f.context.plexAccess = () =>
      Promise.reject(
        new Error("Historical ACK must not resolve current Plex configuration"),
      );
    expect(
      await verifyLibraryPlexBinding(
        f.context,
        f.input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    expect(f.calls).toHaveLength(count);
    await expect(
      cluster.database.operation.update({
        where: { id: f.input.operationId },
        data: { result: Prisma.DbNull },
      }),
    ).rejects.toThrow();
  },
);

test("an adopted anime file binds every episode with its distinct PMS Part", async () => {
  const f = await libraryTvBindingFixture(cluster.database, (directory) =>
    directories.push(directory),
  );
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
  });
  const input = LibraryPlexBindingInputV1Schema.parse(operation.payload);
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      input,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 2 });
  const bindings = await cluster.database.plexBindingCurrent.findMany({
    where: { mediaId: { in: f.episodes.map((episode) => episode.id) } },
    include: { evidence: true },
  });
  expect(bindings).toHaveLength(2);
  expect(bindings.map((binding) => binding.evidence?.assetId)).toEqual([
    f.asset.id,
    f.asset.id,
  ]);
  expect(
    await cluster.database.plexPartClaim.count({
      where: { canonicalPath: f.target },
    }),
  ).toBe(2);
  expect(f.wire.pages).toEqual([0, 0]);
  expect(await readFile(f.target)).toEqual(Buffer.from(f.bytes));
  expect(
    await cluster.database.acquisitionAttempt.count({
      where: { mediaIds: { hasSome: f.episodes.map((episode) => episode.id) } },
    }),
  ).toBe(0);
});

test("renewal cannot move an identical binding's verification clock backward", async () => {
  const f = await fixture("default");
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      f.input,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 1 });
  const key = { mediaId: f.network.media.id, edition: "default" };
  const previous = await cluster.database.plexBindingCurrent.findUniqueOrThrow({
    where: { mediaId_edition: key },
  });
  const operationId = await cluster.database.$transaction((tx) =>
    queueLibraryPlexBinding(tx, {
      receiptId: f.receiptId,
      assetId: f.asset.id,
      recoveryEpoch: 0,
      actorId: f.network.actor.id,
      renewalBucket: 1,
    }),
  );
  const command = await cluster.database.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const execution = testPlexBindingExecution();
  const older = {
    ...execution,
    observed: {
      wall: execution.observed.wall - 10_000,
      monotonic: execution.observed.monotonic - 10_000,
    },
    expiresAtMs: execution.expiresAtMs - 10_000,
  };
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      LibraryPlexBindingInputV1Schema.parse(command.payload),
      older,
    ),
  ).toEqual({ status: "verified", bindingCount: 1 });
  const current = await cluster.database.plexBindingCurrent.findUniqueOrThrow({
    where: { mediaId_edition: key },
  });
  expect(current.revision).toBe(previous.revision);
  expect(current.associationHash).toBe(previous.associationHash);
  expect(current.verifiedStartedAt).toEqual(previous.verifiedStartedAt);
});
