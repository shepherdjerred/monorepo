import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  stagedPerEpisodePublicationFixture,
  sealPerEpisodePublicationFixture,
  compensatePerEpisodePublicationFixture,
} from "#testing/series-workflow/per-episode/publication-fixture.ts";
import { providedAllowance } from "#testing/series-workflow/per-episode/publication-acceptance.ts";
import { perEpisodeSeedCommand } from "#testing/series-workflow/per-episode/seed-command.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { SeriesPackPublicationOutcomeV3Schema } from "#shared/acquisition/series-pack-publication-v1.ts";

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

test("a real six-batch compensation seal permits obsolete source cleanup without changing any original library version or serving binding", async () => {
  await h.context().refreshWriterLease();
  const f = await sealPerEpisodePublicationFixture(
    await stagedPerEpisodePublicationFixture(
      h.database(),
      (directory) => directories.push(directory),
      { original, upgrade },
    ),
  );
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
    throw new Error("Actual compensation scope lost its last leaf");
  await f.f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: last, edition: "default" } },
    data: { monitoring: false, generation: { increment: 1 } },
  });
  expect(
    await providedAllowance((budget) =>
      f.facet.publishSeriesPackMembersV1(
        { ...f.input, batchIndex: 1 },
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "obsolete", reason: "intent_obsolete" });
  const attempt = await f.f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.input.attemptId },
  });
  if (attempt.torrentId === null)
    throw new Error("Actual owned transfer missing");
  const seed = await perEpisodeSeedCommand(
    f.f.db,
    attempt.torrentId,
    attempt.recoveryEpoch,
  );
  const seeding = (budget: PublicationAuthorityReadBudget) =>
    createSeedingActivities({
      ...f.f.context,
      movieManagement: { execution: testPlexBindingExecution(), budget },
    });
  f.f.wire.control.allowSourceRemoval = true;
  expect(
    await providedAllowance((budget) =>
      seeding(budget).removeMediaTorrent(seed),
    ),
  ).toEqual({ status: "protected", reason: "source_in_use" });
  expect(f.f.wire.removals()).toBe(0);
  await compensatePerEpisodePublicationFixture(f);
  const immutable = await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: attempt.id },
  });
  const outcome = SeriesPackPublicationOutcomeV3Schema.parse(immutable.outcome);
  expect(outcome.kind).toBe("compensated");
  expect(outcome.seriesPackPublication.compensationReceipts).toHaveLength(6);
  expect(
    await f.f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toMatchObject({ state: "obsolete" });
  f.f.wire.control.ratio = 1;
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(99);
  await expect(
    seeding(exhausted).removeMediaTorrent(seed),
  ).rejects.toMatchObject({
    code: "archive_transition_reconciliation_required",
  });
  expect(f.f.wire.removals()).toBe(0);
  expect(
    await providedAllowance((budget) =>
      seeding(budget).evaluateMediaSeeding(seed),
    ),
  ).toEqual({ status: "removable", reason: "obligations_satisfied" });
  expect(
    await providedAllowance((budget) =>
      seeding(budget).removeMediaTorrent(seed),
    ),
  ).toEqual({ status: "removed", reason: null });
  expect(f.f.wire.removals()).toBe(1);
  await expect(
    lstat(path.join(f.f.files.roots.tv.downloads, "media", attempt.id)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await f.f.db.libraryAsset.count({ where: { torrentId: seed.torrentId } }),
  ).toBe(0);
  const originals = await f.f.db.libraryAsset.findMany({
    where: { id: { in: f.f.originalAssetIds } },
  });
  expect(originals).toHaveLength(24);
  const checksum = createHash("sha256").update(original).digest("hex");
  for (const asset of originals) {
    expect(asset).toMatchObject({
      state: "published",
      version: 0,
      checksum,
      torrentId: null,
    });
    expect(await sha256File(workerFilePath(f.f.files, asset.path))).toBe(
      checksum,
    );
  }
  const serving = await readCurrentPlexBindings(
    f.f.db,
    f.plan.flatMap((entry) => {
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
    }),
  );
  expect(serving).toHaveLength(24);
  expect(serving.every((read) => read.status === "current")).toBe(true);
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
      seeding(budget).removeMediaTorrent(seed),
    ),
  ).toEqual({ status: "removed", reason: null });
  expect(f.f.wire.removals()).toBe(1);
}, 60_000);
