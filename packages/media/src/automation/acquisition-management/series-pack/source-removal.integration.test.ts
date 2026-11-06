import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  stagedPerEpisodePublicationFixture,
  commitPerEpisodePublicationFixture,
} from "#testing/series-workflow/per-episode/publication-fixture.ts";
import {
  originalAllowance,
  providedAllowance,
} from "#testing/series-workflow/per-episode/publication-acceptance.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

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

test("a real twenty-four-file failed-Plex rollback retains both playable seasons while removing only its isolated owned source under the original hundred-row allowance", async () => {
  await h.context().refreshWriterLease();
  const f = await commitPerEpisodePublicationFixture(
    await stagedPerEpisodePublicationFixture(
      h.database(),
      (directory) => directories.push(directory),
      { original, upgrade },
    ),
  );
  const immutable = await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.input.attemptId },
  });
  f.f.wire.control.rejectPublishedPlex = true;
  f.f.wire.control.allowSourceRemoval = true;
  expect(
    await originalAllowance(() => f.f.publication.publishMediaToPlex(f.input)),
  ).toMatchObject({ status: "blocked" });
  expect(
    await providedAllowance((budget) =>
      f.facet.rollbackPublishedSeriesPackV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "rolled_back" });
  const attempt = await f.f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.input.attemptId },
  });
  const torrentId = attempt.torrentId;
  if (torrentId === null)
    throw new Error("Actual source-owning rollback lost its transfer");
  const seedOperation = await f.f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `seed:${torrentId}` },
  });
  const seedEnvelope = z
    .strictObject({
      kind: z.literal("maintain_torrent"),
      recoveryEpoch: z.int().nonnegative(),
      operationId: z.uuid(),
      torrentId: z.uuid(),
    })
    .parse(seedOperation.payload);
  const seedInput = {
    operationId: seedEnvelope.operationId,
    torrentId: seedEnvelope.torrentId,
  };
  expect(seedOperation).toMatchObject({
    kind: "maintain_torrent",
    targetId: torrentId,
  });
  expect(seedInput).toEqual({ operationId: seedOperation.id, torrentId });
  expect(seedEnvelope.recoveryEpoch).toBe(attempt.recoveryEpoch);
  const seeding = (budget: PublicationAuthorityReadBudget) =>
    createSeedingActivities({
      ...f.f.context,
      movieManagement: { budget, execution: testPlexBindingExecution() },
    });
  // A database rollback is insufficient until the actual Network rebind has settled.
  expect(
    await providedAllowance((budget) =>
      seeding(budget).removeMediaTorrent(seedInput),
    ),
  ).toEqual({ status: "protected", reason: "source_dependencies_changed" });
  expect(f.f.wire.removals()).toBe(0);
  expect(
    await originalAllowance(() =>
      f.f.publication.publishRolledBackMedia(f.input),
    ),
  ).toEqual({ status: "available", reason: null });
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(99);
  await expect(
    seeding(exhausted).removeMediaTorrent(seedInput),
  ).rejects.toMatchObject({
    code: "archive_transition_reconciliation_required",
  });
  expect(f.f.wire.removals()).toBe(0);
  const isolated = path.join(f.f.files.roots.tv.downloads, "media", attempt.id);
  const sourceDirectory = await lstat(isolated);
  expect(sourceDirectory.isDirectory()).toBe(true);
  expect(
    await providedAllowance((budget) =>
      seeding(budget).evaluateMediaSeeding(seedInput),
    ),
  ).toEqual({ status: "seeding", reason: "seeding_required" });
  expect(f.f.wire.removals()).toBe(0);
  // Only the external qBit wire advances a real observation. Original receipt,
  // policy, SQL/SDK clocks and the actual evaluator remain unchanged.
  f.f.wire.control.ratio = 1;
  expect(
    await providedAllowance((budget) =>
      seeding(budget).evaluateMediaSeeding(seedInput),
    ),
  ).toEqual({ status: "removable", reason: "obligations_satisfied" });
  expect(
    await providedAllowance((budget) =>
      seeding(budget).removeMediaTorrent(seedInput),
    ),
  ).toEqual({ status: "removed", reason: null });
  expect(f.f.wire.removals()).toBe(1);
  await expect(lstat(isolated)).rejects.toMatchObject({ code: "ENOENT" });
  const restored = await f.f.db.libraryAsset.findMany({
    where: { id: { in: f.f.originalAssetIds } },
  });
  const expected = createHash("sha256").update(original).digest("hex");
  expect(restored).toHaveLength(24);
  for (const asset of restored) {
    expect(asset).toMatchObject({
      checksum: expected,
      state: "published",
      version: 2,
      torrentId: null,
    });
    expect(await sha256File(workerFilePath(f.f.files, asset.path))).toBe(
      expected,
    );
  }
  const inputs = f.plan.flatMap((entry) => {
    const assetId = entry.previousAssetId;
    return assetId === null
      ? []
      : entry.mediaIds.map((mediaId) => ({
          scope: { mediaId, edition: "default" as const },
          assetId,
          access: {
            serverMachineId: "fixture-server",
            sectionId: "2",
            sectionType: "show" as const,
          },
        }));
  });
  const current = await readCurrentPlexBindings(f.f.db, inputs);
  expect(current).toHaveLength(24);
  expect(current.every((read) => read.status === "current")).toBe(true);
  expect(
    identityHash(
      nativeJson(
        await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
          where: { attemptId: attempt.id },
        }),
      ),
    ),
  ).toBe(identityHash(nativeJson(immutable)));
  expect(
    await providedAllowance((budget) =>
      seeding(budget).removeMediaTorrent(seedInput),
    ),
  ).toEqual({ status: "removed", reason: null });
  expect(f.f.wire.removals()).toBe(1);
}, 60_000);
