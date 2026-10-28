import { rm, readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { afterEach, beforeAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieCleanupFixture } from "#testing/movie-workflow/cleanup-fixture.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { UpgradeCleanupPlexEvidenceSchema } from "#shared/plex-binding/cleanup.ts";

const h = automationTestHarness();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840);
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(MovieEditionKeySchema.options)(
  "actual %s upgrade cleans only its superseded rollback file with its exact verified successor",
  async (edition) => {
    const f = await createMovieCleanupFixture(edition, { original, upgrade });
    closers.push(f.close);
    const oldPath = workerFilePath(f.files, f.old.path);
    expect(
      createHash("sha256")
        .update(await readFile(oldPath))
        .digest("hex"),
    ).toBe(createHash("sha256").update(original).digest("hex"));
    expect(
      await createMediaFileActivities({
        ...f.files,
        now: () => new Date(),
      }).cleanupSupersededMediaFile(f.cleanupInput),
    ).toMatchObject({
      status: "protected",
      reason: "rollback_window_incomplete",
    });
    expect(
      await observeMediaUpgradeCleanup(
        f.context,
        f.cleanupInput,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "observed" });
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.cleanupInput.operationId },
      }),
    ).toMatchObject({
      result: {
        upgradeCleanupPlex: {
          evidence: {
            schemaVersion: 2,
            expected: { schemaVersion: 2, scope: f.scope },
          },
        },
      },
    });
    expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual(
      { status: "purged" },
    );
    expect(
      f.old.subtitles.filter((subtitle) => subtitle.storageKind === "sidecar"),
    ).toHaveLength(2);
    for (const subtitle of f.old.subtitles) {
      if (subtitle.path === null)
        throw new Error("Actual installed old sidecar missing");
      await expect(
        access(workerFilePath(f.files, subtitle.path)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await f.db.subtitleAsset.findUniqueOrThrow({
          where: { id: subtitle.id },
        }),
      ).toMatchObject({ state: "purged", videoVersion: f.old.version + 1 });
    }
    await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      createHash("sha256")
        .update(await readFile(f.target))
        .digest("hex"),
    ).toBe(createHash("sha256").update(upgrade).digest("hex"));
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.successor.id },
      }),
    ).toEqual(f.successor);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.publication.id },
      }),
    ).toEqual(f.publication);
    expect(
      await f.db.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: f.transition.id },
      }),
    ).toEqual(f.transition);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
    ).toMatchObject({ state: "purged", edition });
    f.files.enabled.purge = () => Promise.resolve(false);
    expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual(
      { status: "purged" },
    );
  },
  60_000,
);

test("an active session cannot grant named cleanup authority", async () => {
  const f = await createMovieCleanupFixture("directors_cut", {
    original,
    upgrade,
  });
  closers.push(f.close);
  f.wire.control.sessions = [
    {
      ratingKey: "synthetic-active",
      type: "movie",
      title: "Synthetic active playback",
      Media: [{ Part: [{ id: 999_999, file: f.old.path }] }],
    },
  ];
  expect(
    await observeMediaUpgradeCleanup(
      f.context,
      f.cleanupInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "protected", reason: "reconciliation_required" });
  expect(
    await f.physical.cleanupSupersededMediaFile(f.cleanupInput),
  ).toMatchObject({ status: "protected" });
  expect(
    createHash("sha256")
      .update(await readFile(workerFilePath(f.files, f.old.path)))
      .digest("hex"),
  ).toBe(createHash("sha256").update(original).digest("hex"));
}, 60_000);

test("named cleanup resumes its exact purge journal after a physical effect and failed transaction", async () => {
  const f = await createMovieCleanupFixture("directors_cut", {
    original,
    upgrade,
  });
  closers.push(f.close);
  expect(
    await observeMediaUpgradeCleanup(
      f.context,
      f.cleanupInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "observed" });
  f.files.checkpoint = (phase) =>
    phase === "purged"
      ? Promise.reject(
          new Error("Interrupted named purge after its physical effect"),
        )
      : Promise.resolve();
  await expect(
    f.physical.cleanupSupersededMediaFile(f.cleanupInput),
  ).rejects.toThrow("Interrupted named purge after its physical effect");
  expect(f.cleanup.manifest).toBeNull();
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: f.cleanupInput.operationId },
  });
  const observation = z
    .object({
      upgradeCleanupPlex: z.object({
        evidence: UpgradeCleanupPlexEvidenceSchema,
      }),
    })
    .parse(operation.result);
  expect(
    await f.db.upgradeCleanup.findUniqueOrThrow({
      where: { id: f.cleanup.id },
    }),
  ).toMatchObject({
    state: "pending",
    version: f.cleanup.version + 1,
    manifest: observation.upgradeCleanupPlex.evidence.expected.plan,
  });
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toMatchObject({ state: "superseded", version: f.old.version });
  f.files.checkpoint = () => Promise.resolve();
  expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual({
    status: "purged",
  });
  await expect(
    access(workerFilePath(f.files, f.old.path)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    createHash("sha256")
      .update(await readFile(f.target))
      .digest("hex"),
  ).toBe(createHash("sha256").update(upgrade).digest("hex"));
  expect(
    await f.db.operation.findUniqueOrThrow({ where: { id: f.publication.id } }),
  ).toEqual(f.publication);
  expect(
    await f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  ).toEqual(f.transition);
}, 60_000);

test("Network and Files retain the caller's exhausted provenance allowance", async () => {
  const f = await createMovieCleanupFixture("uncut_version", {
    original,
    upgrade,
  });
  closers.push(f.close);
  const networkBudget = new PublicationAuthorityReadBudget();
  networkBudget.consume(99);
  const execution = testPlexBindingExecution();
  await expect(
    observeMediaUpgradeCleanup(
      { ...f.context, movieManagement: { execution, budget: networkBudget } },
      f.cleanupInput,
      execution,
    ),
  ).rejects.toThrow("100 total queried records");
  expect(
    await observeMediaUpgradeCleanup(
      f.context,
      f.cleanupInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "observed" });
  const fileBudget = new PublicationAuthorityReadBudget();
  fileBudget.consume(99);
  const fileExecution = testPublicationExecution();
  const files = createMediaFileActivities({
    ...f.files,
    publicationExecution: () => fileExecution,
    movieManagement: { execution: fileExecution, budget: fileBudget },
  });
  await expect(
    files.cleanupSupersededMediaFile(f.cleanupInput),
  ).rejects.toThrow("100 total queried records");
  expect(
    createHash("sha256")
      .update(await readFile(workerFilePath(f.files, f.old.path)))
      .digest("hex"),
  ).toBe(createHash("sha256").update(original).digest("hex"));
}, 60_000);

test("SDK expiry during named Plex metadata cannot renew cleanup authority", async () => {
  const f = await createMovieCleanupFixture("final_cut", { original, upgrade });
  closers.push(f.close);
  const originalExecution = testPlexBindingExecution();
  const expiry = new Error("Original cleanup SDK expired during metadata");
  let expired = false;
  f.wire.control.beforeMetadata = () => {
    expired = true;
    return Promise.resolve();
  };
  const execution = {
    ...originalExecution,
    assertActive: () => {
      originalExecution.assertActive();
      if (expired) throw expiry;
    },
  };
  await expect(
    observeMediaUpgradeCleanup(f.context, f.cleanupInput, execution),
  ).rejects.toBe(expiry);
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.cleanupInput.operationId },
    }),
  ).toMatchObject({ result: null });
  expect(
    createHash("sha256")
      .update(await readFile(workerFilePath(f.files, f.old.path)))
      .digest("hex"),
  ).toBe(createHash("sha256").update(original).digest("hex"));
}, 60_000);

test.each(["pin", "generation"] as const)(
  "a later %s protects both named rollback bytes and the serving copy",
  async (change) => {
    const f = await createMovieCleanupFixture("extended_cut", {
      original,
      upgrade,
    });
    closers.push(f.close);
    expect(
      await observeMediaUpgradeCleanup(
        f.context,
        f.cleanupInput,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "observed" });
    if (change === "pin")
      await f.db.retentionHold.create({
        data: {
          userId: f.network.actor.id,
          mediaId: f.scope.mediaId,
          edition: f.scope.edition,
          isPin: true,
        },
      });
    else
      await f.db.mediaIntent.update({
        where: {
          mediaId_edition: {
            mediaId: f.scope.mediaId,
            edition: f.scope.edition,
          },
        },
        data: { generation: { increment: 1 } },
      });
    expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual(
      {
        status: "protected",
        reason:
          change === "pin"
            ? "cleanup_media_held"
            : "cleanup_generation_changed",
      },
    );
    expect(
      createHash("sha256")
        .update(await readFile(workerFilePath(f.files, f.old.path)))
        .digest("hex"),
    ).toBe(createHash("sha256").update(original).digest("hex"));
    expect(
      createHash("sha256")
        .update(await readFile(f.target))
        .digest("hex"),
    ).toBe(createHash("sha256").update(upgrade).digest("hex"));
  },
  60_000,
);

test("another cut's actual request and Keep do not authorize or prevent this edition's cleanup", async () => {
  const f = await createMovieCleanupFixture("directors_cut", {
    original,
    upgrade,
  });
  closers.push(f.close);
  const other = await requestTestMovieV4(
    f.db,
    f.network.actor,
    f.scope.mediaId,
    "extended_cut",
  );
  const hold = await f.db.retentionHold.create({
    data: {
      userId: f.network.actor.id,
      mediaId: other.input.scope.mediaId,
      edition: other.input.scope.edition,
      isPin: true,
    },
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.network.actor.id,
        mediaId: f.scope.mediaId,
        edition: "extended_cut",
      },
    },
  });
  expect(
    await observeMediaUpgradeCleanup(
      f.context,
      f.cleanupInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "observed" });
  expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual({
    status: "purged",
  });
  expect(
    await f.db.retentionHold.findUniqueOrThrow({ where: { id: hold.id } }),
  ).toEqual(hold);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
  ).toEqual(request);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.successor.id },
    }),
  ).toEqual(f.successor);
}, 60_000);

test("an adopted edition retains its actual unresolved household-history hold", async () => {
  const adoptedUpgrade = await movieVideoFixture(3840, undefined, {
    bitrateKbps: 160_000,
  });
  const f = await createMovieCleanupFixture(
    "directors_cut",
    { original, upgrade: adoptedUpgrade },
    { h, directoryCreated: (directory) => directories.push(directory) },
  );
  closers.push(f.close);
  expect(
    await f.db.recoveryHold.count({
      where: {
        mediaId: f.scope.mediaId,
        edition: f.scope.edition,
        releasedAt: null,
      },
    }),
  ).toBe(1);
  expect(
    await observeMediaUpgradeCleanup(
      f.context,
      f.cleanupInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "observed" });
  expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual({
    status: "protected",
    reason: "recovery_request_history_unconfirmed",
  });
  expect(
    createHash("sha256")
      .update(await readFile(workerFilePath(f.files, f.old.path)))
      .digest("hex"),
  ).toBe(createHash("sha256").update(original).digest("hex"));
  expect(
    await f.db.mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
}, 60_000);
