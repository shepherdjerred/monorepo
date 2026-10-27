import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { libraryTvBindingFixture } from "#automation/plex-binding/library-tv.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readLibrarySeriesManagement } from "./library-management.ts";
import { lockAcquisitionMedia } from "./locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";

const h = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const db = h.database();
  const f = await libraryTvBindingFixture(db, (directory) =>
    directories.push(directory),
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
  });
  expect(
    await verifyLibraryPlexBinding(
      f.context,
      LibraryPlexBindingInputV1Schema.parse(operation.payload),
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 2 });
  const input = {
    mediaIds: f.episodes.map((episode) => episode.id).sort(),
    epoch: 0,
    access: await f.context.plexAccess("show"),
  };
  const invocation = {
    freshness: testPlexBindingExecution(),
    budget: new PublicationAuthorityReadBudget(),
    access: input.access,
  };
  const read = (
    request: Parameters<typeof readLibrarySeriesManagement>[1] = input,
  ) =>
    db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, request.mediaIds);
      if (!(await lockRuntimeAuthority(tx, request.epoch)))
        throw new Error("Actual library ownership missing");
      return readLibrarySeriesManagement(tx, request, invocation);
    });
  return { ...f, db, input, invocation, read };
}

test("actual adopted TV policy authorizes complete episode coverage without creating personal requests or torrent history", async () => {
  const f = await fixture();
  const authority = await f.read();
  expect(authority?.proof).toMatchObject({
    kind: "library_series_management",
    seriesId: f.series.id,
    receiptId: f.receiptId,
    actorId: f.network.actor.id,
    profileId: f.profile.id,
    targets: f.input.mediaIds.map((mediaId) => ({ mediaId, generation: 1 })),
  });
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.series.id, ...f.input.mediaIds] } },
    }),
  ).toBe(0);
  expect(await f.db.acquisitionAttempt.count()).toBe(0);
  expect(await f.db.torrent.count()).toBe(0);
  if (authority === null) throw new Error("Actual adopted policy missing");
  const repeated = await f.read({ ...f.input, expected: authority.proof });
  expect(repeated?.proof).toEqual(authority.proof);
});

test.each(["owner", "root", "leaf"] as const)(
  "changed %s authority protects an existing library management birth",
  async (change) => {
    const f = await fixture();
    const authority = await f.read();
    if (authority === null) throw new Error("Actual adopted policy missing");
    if (change === "owner")
      await f.db.mediaUser.update({
        where: { id: f.network.actor.id },
        data: { restricted: true },
      });
    else if (change === "root")
      await f.db.mediaIntent.upsert({
        where: {
          mediaId_edition: { mediaId: f.series.id, edition: "default" },
        },
        create: { mediaId: f.series.id, generation: 1, monitoring: false },
        update: { generation: { increment: 1 }, monitoring: false },
      });
    else
      await f.db.mediaIntent.update({
        where: {
          mediaId_edition: {
            mediaId: f.input.mediaIds[0] ?? "",
            edition: "default",
          },
        },
        data: { monitoring: false, generation: { increment: 1 } },
      });
    await expect(
      f.read({ ...f.input, expected: authority.proof }),
    ).rejects.toMatchObject({ code: "library_management_unconfirmed" });
    expect(await f.db.acquisitionAttempt.count()).toBe(0);
  },
);

test("library management does not renew original invocation freshness or reset the caller's provenance budget", async () => {
  const f = await fixture();
  f.invocation.budget.consume(99);
  await expect(f.read()).rejects.toThrow("100 total queried records");
  const expired = {
    ...f.invocation,
    freshness: {
      expiresAtMs: 0,
      assertActive: () => {
        throw new Error("Original SDK expired");
      },
    },
  };
  await expect(
    readLibrarySeriesManagement(f.db, f.input, expired),
  ).rejects.toThrow("Original SDK expired");
});
