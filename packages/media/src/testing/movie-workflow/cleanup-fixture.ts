import { z } from "zod";
import { expect } from "vitest";
import { createManagedMovieFixture } from "./managed-fixture.ts";
import type { automationTestHarness } from "#testing/automation.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import {
  createAcquiredMovieUpgradeFixture,
  installMovieFixtureCaptions,
} from "./upgrade-fixture.ts";

/** Real import and new acquisition/publication; only elapsed rollback policy time and remote wires are simulated. */
export async function createMovieCleanupFixture(
  edition: MovieEditionKey,
  bytes: {
    original: Uint8Array;
    upgrade: Uint8Array;
  },
  adoption?: {
    h: Pick<ReturnType<typeof automationTestHarness>, "database">;
    directoryCreated: (directory: string) => void;
  },
) {
  const f =
    adoption === undefined
      ? await createAcquiredMovieUpgradeFixture(edition, bytes)
      : {
          ...(await createManagedMovieFixture(
            adoption.h,
            edition,
            adoption.directoryCreated,
            bytes,
          )),
          close: () => Promise.resolve(),
        };
  try {
    const db = f.context.db;
    const result = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(result.status).toBe("acquire");
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      scope: f.scope,
      attemptId: z.uuid().parse(result.attemptId),
    };
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    // No cleanup may start its rollback clock before the actual Plex completion.
    expect(
      await db.upgradeCleanup.count({ where: { assetId: f.asset.id } }),
    ).toBe(0);
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    if (adoption !== undefined)
      await grantTestExclusionProofs(db, f.network.actor.id, "fixture-server");
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const plan = MovieFilePlanSchema.parse(attempt.filePlan);
    if (adoption === undefined)
      await installMovieFixtureCaptions(
        db,
        plan.entries[0].assetId,
        f.movie,
        f.fileMovie,
      );
    const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
      where: {
        assetId_successorAssetId: {
          assetId: f.asset.id,
          successorAssetId: plan.entries[0].assetId,
        },
      },
    });
    const old = await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: true },
    });
    const successor = await db.libraryAsset.findUniqueOrThrow({
      where: { id: cleanup.successorAssetId },
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `upgrade-cleanup:${cleanup.id}` },
    });
    const publication = await db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: input.attemptId },
    });
    const policyTime = new Date(cleanup.expiresAt.getTime() + 1);
    const context = { ...f.context, now: () => policyTime };
    const files = {
      ...f.files,
      now: () => policyTime,
      publicationExecution: testPublicationExecution,
    };
    return {
      ...f,
      db,
      context,
      files,
      cleanup,
      old,
      successor,
      publication,
      transition,
      attempt,
      policyTime,
      cleanupInput: { operationId: operation.id, cleanupId: cleanup.id },
      physical: createMediaFileActivities(files),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
