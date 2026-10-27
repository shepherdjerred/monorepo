import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { z } from "zod";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { acquisitionInvocation } from "./invocation.ts";
import { reconcileUnconfirmedSubmission } from "./recovery.ts";

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

test("actual adopted shared TV file upgrades from the recurring sweep without personal requests or historical torrent takeover", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const { db, ids, wire, acquired, physical, publication } = f;
  expect(await db.mediaRequest.count({ where: { mediaId: { in: ids } } })).toBe(
    0,
  );
  expect(
    await db.acquisitionAttempt.count({
      where: { mediaIds: { hasSome: ids } },
    }),
  ).toBe(0);
  const command = await f.reserve();
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: command.attemptId },
    }),
  ).toMatchObject({
    sponsorRequestId: null,
    identityEvidence: {
      schemaVersion: 4,
      management: { receiptId: f.receiptId },
    },
  });
  expect(await acquired.submitMediaTorrent(command)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await acquired.observeMediaAcquisition(command)).toEqual({
    status: "ready",
    reason: null,
  });
  expect(await physical.inspectAndStageMedia(command)).toEqual({
    status: "staged",
  });
  expect(await physical.promoteMediaFiles(command)).toEqual({
    status: "published",
  });
  expect(await publication.publishMediaToPlex(command)).toEqual({
    status: "available",
    reason: null,
  });
  await publication.finalizeMediaAcquisition(command);
  const checksum = createHash("sha256").update(upgrade).digest("hex");
  expect(
    createHash("sha256")
      .update(await readFile(f.target))
      .digest("hex"),
  ).toBe(checksum);
  const current = await db.assetCoverage.findMany({
    where: { mediaId: { in: ids }, edition: "default", current: true },
    include: { asset: true },
  });
  expect(current).toHaveLength(2);
  expect(new Set(current.map((row) => row.assetId)).size).toBe(1);
  expect(
    current.every(
      (row) =>
        row.asset.path === path.join("/data/tv", path.basename(f.target)) &&
        row.asset.checksum === checksum,
    ),
  ).toBe(true);
  expect(await db.mediaRequest.count({ where: { mediaId: { in: ids } } })).toBe(
    0,
  );
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: command.attemptId },
    }),
  ).toMatchObject({ state: "completed", sponsorRequestId: null });
  expect(wire.additions()).toBe(1);
  const completed = await db.operation.findUniqueOrThrow({
    where: { id: command.operationId },
  });
  const receiptHash = identityHash(completed.result);
  expect(completed.result).toMatchObject({
    managedEpisodePlexReceiptV2: {
      receipt: { schemaVersion: 2, attempt: { sponsorRequestId: null } },
    },
  });
  await db.mediaUser.update({
    where: { id: f.network.actor.id },
    data: { restricted: true },
  });
  await db.mediaIntent.updateMany({
    where: { edition: "default", mediaId: { in: ids } },
    data: { monitoring: false, generation: { increment: 1 } },
  });
  f.files.enabled.acquisition = () => Promise.resolve(false);
  f.context.gates.acquisition = () => Promise.resolve(false);
  expect(await acquired.submitMediaTorrent(command)).toEqual({
    status: "submitted",
    reason: "resume_committed_publication",
  });
  expect(await acquired.observeMediaAcquisition(command)).toEqual({
    status: "ready",
    reason: "resume_committed_publication",
  });
  expect(await physical.inspectAndStageMedia(command)).toEqual({
    status: "staged",
  });
  expect(await physical.promoteMediaFiles(command)).toEqual({
    status: "published",
  });
  expect(await publication.publishMediaToPlex(command)).toEqual({
    status: "available",
    reason: null,
  });
  await expect(
    db.$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{managedEpisodePlexReceiptV2,receipt,schemaVersion}','3'::jsonb) WHERE id=${command.operationId}`,
  ).rejects.toThrow("immutable");
  const repeatedCommand = await db.operation.findUniqueOrThrow({
    where: { id: command.operationId },
  });
  expect(identityHash(repeatedCommand.result)).toBe(receiptHash);
  const repeatedAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
  });
  expect(repeatedAttempt.state).toBe("completed");
  expect(wire.additions()).toBe(1);
});

test.each(["leaf", "owner", "profile", "reservation"] as const)(
  "changed %s authority cancels only a known unsubmitted managed reservation",
  async (change) => {
    const f = await createManagedSeriesFixture(
      h.database(),
      (directory) => directories.push(directory),
      { original, upgrade },
    );
    const command = await f.reserve();
    const mediaId = z.uuid().parse(f.ids[0]);
    switch (change) {
      case "leaf":
        await f.db.mediaIntent.update({
          where: { mediaId_edition: { mediaId, edition: "default" } },
          data: { monitoring: false, generation: { increment: 1 } },
        });
        break;
      case "owner":
        await f.db.mediaUser.update({
          where: { id: f.network.actor.id },
          data: { restricted: true },
        });
        break;
      case "profile":
        await f.db.qualityProfile.update({
          where: { id: f.profile.id },
          data: { version: { increment: 1 } },
        });
        break;
      case "reservation":
        await f.db.acquisitionReservation.deleteMany({
          where: { attemptId: command.attemptId, mediaId },
        });
        break;
    }
    expect(await f.acquired.submitMediaTorrent(command)).toEqual({
      status: "obsolete",
      reason: "intent_changed",
    });
    const settled = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: command.attemptId },
    });
    expect(settled.state).toBe("cancelled");
    expect(
      await f.db.acquisitionReservation.count({
        where: { attemptId: command.attemptId },
      }),
    ).toBe(0);
    expect(f.wire.additions()).toBe(0);
    expect(
      await f.db.mediaRequest.count({ where: { mediaId: { in: f.ids } } }),
    ).toBe(0);
  },
);

test("a lost add reply remains observe-only after household permission is revoked and retains new-transfer seeding responsibility", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const command = await f.reserve();
  f.wire.control.loseReply = true;
  expect(await f.acquired.submitMediaTorrent(command)).toMatchObject({
    status: "blocked",
  });
  f.wire.control.visible = false;
  expect(await f.acquired.submitMediaTorrent(command)).toEqual({
    status: "blocked",
    reason: "submission_outcome_unknown",
  });
  expect(f.wire.additions()).toBe(1);
  await f.db.mediaUser.update({
    where: { id: f.network.actor.id },
    data: { restricted: true },
  });
  f.wire.control.visible = true;
  await reconcileUnconfirmedSubmission(f.context, command.attemptId);
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
    include: { torrent: true },
  });
  expect(attempt).toMatchObject({
    state: "cancelled",
    sponsorRequestId: null,
    torrent: { owned: true },
  });
  expect(
    await f.db.operation.count({
      where: {
        kind: "maintain_torrent",
        targetId: z.uuid().parse(attempt.torrentId),
      },
    }),
  ).toBe(1);
  expect(f.wire.additions()).toBe(1);
  expect(
    await f.db.acquisitionReservation.count({
      where: { attemptId: attempt.id },
    }),
  ).toBe(0);
});

test("prepared managed files retain their exact reservation when permission changes", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const command = await f.reserve();
  expect(await f.acquired.submitMediaTorrent(command)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await f.acquired.observeMediaAcquisition(command)).toEqual({
    status: "ready",
    reason: null,
  });
  expect(await f.physical.inspectAndStageMedia(command)).toEqual({
    status: "staged",
  });
  const prepared = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
  });
  const originalPlan = prepared.filePlan;
  await f.db.mediaUser.update({
    where: { id: f.network.actor.id },
    data: { restricted: true },
  });
  expect(await f.acquired.submitMediaTorrent(command)).toEqual({
    status: "obsolete",
    reason: "intent_changed",
  });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
  });
  expect(attempt.state).toBe("validating");
  expect(identityHash(attempt.filePlan)).toBe(identityHash(originalPlan));
  expect(
    await f.db.acquisitionReservation.count({
      where: { attemptId: attempt.id },
    }),
  ).toBe(2);
  expect(f.wire.additions()).toBe(1);
});

test("expiry during the final qBittorrent lookup cannot renew the original SDK capability or add a torrent", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const command = await f.reserve();
  const execution = f.context.plexBindingExecution();
  let expired = false;
  f.wire.control.beforeInfo = () => {
    expired = true;
    return Promise.resolve();
  };
  const acquired = createAcquisitionActivities({
    ...f.context,
    plexBindingExecution: () => ({
      ...execution,
      assertActive: () => {
        execution.assertActive();
        if (expired) throw new Error("Original SDK expired during lookup");
      },
    }),
  });
  await expect(acquired.submitMediaTorrent(command)).rejects.toThrow(
    "Original SDK expired during lookup",
  );
  expect(f.wire.additions()).toBe(0);
});

test("file publication consumes the caller's remaining provenance allowance without resetting it", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const command = await f.reserve();
  expect(await f.acquired.submitMediaTorrent(command)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await f.acquired.observeMediaAcquisition(command)).toEqual({
    status: "ready",
    reason: null,
  });
  expect(await f.physical.inspectAndStageMedia(command)).toEqual({
    status: "staged",
  });
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  const physical = createMediaFileActivities({
    ...f.files,
    libraryManagement: {
      freshness: f.context.plexBindingExecution(),
      budget,
      access: await f.context.plexAccess("show"),
    },
  });
  await expect(physical.promoteMediaFiles(command)).rejects.toThrow(
    "100 total queried records",
  );
  expect(
    createHash("sha256")
      .update(await readFile(f.target))
      .digest("hex"),
  ).toBe(createHash("sha256").update(original).digest("hex"));
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  expect(asset.state).toBe("published");
  expect(
    await f.db.assetCoverage.count({
      where: { assetId: asset.id, current: true },
    }),
  ).toBe(2);
});

test("a late original proof window protects TV while preserving the ordinary movie SDK contract", async () => {
  const legacy = await h.fixture();
  const base = h.context();
  const sdk = base.plexBindingExecution();
  const observed = {
    wall: sdk.observed.wall - 90_000,
    monotonic: sdk.observed.monotonic - 90_000,
  };
  const retained = { ...sdk, observed, expiresAtMs: observed.wall + 60_000 };
  const invocation = await acquisitionInvocation(
    { ...base, plexBindingExecution: () => retained },
    { mediaId: legacy.media.id },
  );
  expect(invocation.libraryManagement).toBeUndefined();
  expect(invocation.plexBindingExecution()).toBe(retained);
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  await expect(
    acquisitionInvocation(
      { ...f.context, plexBindingExecution: () => retained },
      { mediaId: z.uuid().parse(f.ids[0]) },
    ),
  ).rejects.toMatchObject({ reason: "verification_expired" });
});

test("download reconciliation keeps the sweep's exhausted allowance while retaining proven seeding responsibility", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const command = await f.reserve();
  f.wire.control.loseReply = true;
  expect(await f.acquired.submitMediaTorrent(command)).toMatchObject({
    status: "blocked",
  });
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  const execution = f.context.plexBindingExecution();
  await expect(
    reconcileUnconfirmedSubmission(
      { ...f.context, movieManagement: { execution, budget } },
      command.attemptId,
    ),
  ).rejects.toThrow("100 total queried records");
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
    include: { torrent: true },
  });
  expect(attempt).toMatchObject({
    state: "submission_observed",
    torrent: { owned: true },
  });
  expect(
    await f.db.operation.count({
      where: {
        kind: "maintain_torrent",
        targetId: z.uuid().parse(attempt.torrentId),
      },
    }),
  ).toBe(1);
  expect(f.wire.additions()).toBe(1);
});
