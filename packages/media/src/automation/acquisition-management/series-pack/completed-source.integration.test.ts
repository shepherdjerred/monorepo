import path from "node:path";
import { lstat, rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  stagedPerEpisodePublicationFixture,
  commitPerEpisodePublicationFixture,
} from "#testing/series-workflow/per-episode/publication-fixture.ts";
import {
  providedAllowance,
  originalAllowance,
} from "#testing/series-workflow/per-episode/publication-acceptance.ts";
import { assertAndInstallActualCaptions } from "#testing/series-workflow/per-episode/caption-acceptance.ts";
import { perEpisodeSeedCommand } from "#testing/series-workflow/per-episode/seed-command.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { createOutboxActivities } from "#automation/store.ts";
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

test("a genuine completed twenty-four-file publication protects pending household captions, then removes only its owned source after actual caption installation and policy satisfaction", async () => {
  await h.context().refreshWriterLease();
  const f = await commitPerEpisodePublicationFixture(
    await stagedPerEpisodePublicationFixture(
      h.database(),
      (directory) => directories.push(directory),
      { original, upgrade },
    ),
  );
  expect(
    await originalAllowance(() => f.f.publication.publishMediaToPlex(f.input)),
  ).toEqual({ status: "available", reason: null });
  await f.f.publication.finalizeMediaAcquisition(f.input);
  const attempt = await f.f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.input.attemptId },
  });
  expect(attempt.state).toBe("completed");
  if (attempt.torrentId === null)
    throw new Error("Actual completed source-owning attempt lost its transfer");
  const seed = await perEpisodeSeedCommand(
    f.f.db,
    attempt.torrentId,
    attempt.recoveryEpoch,
  );
  const immutable = await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: attempt.id },
  });
  const assets = f.plan.map((entry) => entry.assetId);
  const pending = await f.f.db.operation.findMany({
    where: {
      kind: "acquire_subtitles",
      targetId: { in: assets },
      status: { in: ["queued", "running"] },
    },
  });
  expect(pending).toHaveLength(48);
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
  ).toEqual({ status: "protected", reason: "source_dependencies_changed" });
  expect(f.f.wire.removals()).toBe(0);
  // Real Network lookup, native Files installation and exact text/hash assertions.
  // Only after those effects does the actual mature completion producer settle
  // the corresponding original queued commands, matching subtitle Workflow order.
  await assertAndInstallActualCaptions(f.f, attempt.id, 24, {
    targets: "already_queued",
    commands: pending.map((operation) => ({
      operationId: operation.id,
      payloadHash: identityHash(operation.payload),
    })),
  });
  const finish = createOutboxActivities(f.f.db, () =>
    Promise.reject(new Error("Completion cannot dispatch")),
  ).finishMediaOperation;
  for (const operation of pending)
    await finish({
      operationId: operation.id,
      status: "completed",
      reason: null,
    });
  expect(
    await f.f.db.operation.count({
      where: {
        id: { in: pending.map((operation) => operation.id) },
        status: "completed",
      },
    }),
  ).toBe(48);
  expect(
    await providedAllowance((budget) =>
      createSeedingActivities({
        ...f.f.context,
        serverMachineId: "different-configured-server",
        movieManagement: { execution: testPlexBindingExecution(), budget },
      }).evaluateMediaSeeding(seed),
    ),
  ).toEqual({ status: "protected", reason: "source_dependencies_changed" });
  expect(
    await providedAllowance((budget) =>
      createSeedingActivities({
        ...f.f.context,
        permittedSections: () => Promise.resolve({ movie: "1", series: "99" }),
        movieManagement: { execution: testPlexBindingExecution(), budget },
      }).evaluateMediaSeeding(seed),
    ),
  ).toEqual({ status: "protected", reason: "source_dependencies_changed" });
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
  ).toEqual({ status: "seeding", reason: "seeding_required" });
  f.f.wire.control.ratio = 1;
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
  const current = await readCurrentPlexBindings(
    f.f.db,
    f.plan.flatMap((entry) =>
      entry.mediaIds.map((mediaId) => ({
        scope: { mediaId, edition: "default" as const },
        assetId: entry.assetId,
        access: {
          serverMachineId: "fixture-server",
          sectionId: "2",
          sectionType: "show" as const,
        },
      })),
    ),
  );
  expect(current).toHaveLength(24);
  expect(current.every((read) => read.status === "current")).toBe(true);
  for (const asset of await f.f.db.libraryAsset.findMany({
    where: { id: { in: assets } },
  })) {
    expect(asset).toMatchObject({ state: "published", version: 0 });
    expect(await sha256File(workerFilePath(f.f.files, asset.path))).toBe(
      asset.checksum,
    );
  }
  expect(
    await f.f.db.subtitleAsset.count({
      where: {
        assetId: { in: assets },
        state: "installed",
        storageKind: "sidecar",
      },
    }),
  ).toBe(48);
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
