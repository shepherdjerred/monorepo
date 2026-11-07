import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryCleanupFixture } from "#testing/movie-workflow/history/history-cleanup-fixture.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { MovieHistoryClaimAccountingV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { RunJournalSchema } from "#automation/plex-exclusion/state.ts";
import { PlexExclusionPlanSchema } from "#shared/plex-exclusion.ts";
import { z } from "zod";

let original: Uint8Array;
let upgrade: Uint8Array;
const closers: (() => Promise<void>)[] = [];
const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("an actual default v3 claim ledger admits verified management upgrade cleanup without legacy reopening", async () => {
  const startedAt = Date.now();
  const f = await createMovieHistoryCleanupFixture({ original, upgrade });
  closers.push(f.close);
  const scanner = await f.db.plexExclusionProof.findFirstOrThrow({
    where: { libraryRoot: "/data/movies", revokedAt: null },
    include: { run: true },
  });
  const plan = PlexExclusionPlanSchema.parse(scanner.run.plan);
  const scannerJournal = RunJournalSchema.parse(scanner.run.journal);
  for (const phase of [scannerJournal.scan, scannerJournal.cleanupScan]) {
    if (phase?.first == null || phase.second === null)
      throw new Error("Genuine two-pass scanner observations missing");
    expect(Date.parse(phase.first.observedAt)).toBeGreaterThanOrEqual(
      startedAt,
    );
    expect(
      Date.parse(phase.second.observedAt) - Date.parse(phase.first.observedAt),
    ).toBeGreaterThanOrEqual(10_000);
    expect(Date.parse(phase.second.observedAt)).toBeLessThanOrEqual(Date.now());
    expect(phase.state).toBe("verified");
  }
  const durable = z
    .object({ planDigest: z.string(), journal: z.json() })
    .parse(
      JSON.parse(
        await readFile(
          workerFilePath(
            f.files,
            `${plan.controlRoot}/exclusion-${plan.runId}.json`,
          ),
          "utf8",
        ),
      ),
    );
  expect(durable.planDigest).toBe(scanner.run.planDigest);
  expect(RunJournalSchema.shape.files.unwrap().parse(durable.journal)).toEqual(
    scannerJournal.files,
  );
  expect(plan.libraryRoot).toBe("/data/movies");
  expect(plan.controlRoot).toBe("/data/movies/.media-control");
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { reviewId: f.released.recoveryReviewId },
  });
  expect(
    MovieHistoryClaimAccountingV3Schema.parse(receipt.claimAccounting).claims,
  ).toHaveLength(1);
  const hold = await f.db.recoveryHold.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
    },
  });
  expect(hold.releasedAt).toBeInstanceOf(Date);
  const oldPath = workerFilePath(f.files, f.old.path);
  const target = workerFilePath(f.files, f.successor.path);
  expect(checksum(await readFile(oldPath))).toBe(checksum(original));
  const networkExecution = testPlexBindingExecution();
  const networkBudget = new PublicationAuthorityReadBudget();
  expect(
    await observeMediaUpgradeCleanup(
      {
        ...f.context,
        movieManagement: { execution: networkExecution, budget: networkBudget },
      },
      f.cleanupInput,
      networkExecution,
    ),
  ).toEqual({ status: "observed" });
  expect(() => networkBudget.consume(0)).not.toThrow();
  const execution = testPublicationExecution();
  const budget = new PublicationAuthorityReadBudget();
  expect(
    await createMediaFileActivities({
      ...f.files,
      publicationExecution: () => execution,
      movieManagement: { execution, budget },
    }).cleanupSupersededMediaFile(f.cleanupInput),
  ).toEqual({ status: "purged" });
  expect(() => budget.consume(0)).not.toThrow();
  await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(checksum(await readFile(target))).toBe(checksum(upgrade));
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
      },
    }),
  ).toEqual(hold);
  expect(
    await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    }),
  ).toEqual(receipt);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.successor.id },
    }),
  ).toEqual(f.successor);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toMatchObject({ state: "purged", owned: true });
  expect(f.wire.additions()).toBe(1);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    }),
  ).toBe(1);
  expect(
    await f.db.movieEditionChoice.count({
      where: { rootMediaId: f.scope.mediaId },
    }),
  ).toBe(0);
}, 60_000);
