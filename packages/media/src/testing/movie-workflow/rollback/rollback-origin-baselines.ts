import { rm } from "node:fs/promises";
import { z } from "zod";
import { expect } from "vitest";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { FileContext } from "#automation/files/types.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { mapMovieHistoryAccounts } from "#testing/movie-workflow/history/history-review-accounts.ts";
import { PrismaMovieHistoryReviews } from "#infrastructure/movie-editions/history-review/service.ts";
import {
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { movieDefinitionRef } from "#infrastructure/movie-editions/definition.ts";
import { createRestoredMovieFixture } from "#testing/movie-workflow/restore-fixture.ts";
import { publishRestoredMovieToPlexV4 } from "#automation/movie-editions/retention/restore-plex.ts";
import { finalizeMovieRestorationV4 } from "#automation/movie-editions/retention/restore-finalization.ts";
import { createOutboxActivities } from "#automation/store.ts";

export type MovieRollbackOriginBaseline = {
  kind: "library" | "restored";
  db: Database;
  scope: MovieEditionScope;
  context: MediaAutomationContext;
  files: FileContext;
  actor: MediaActor;
  assetId: string;
  originalParents: () => Promise<unknown>;
  close: () => Promise<void>;
};

/** Initial Files/Plex approval owns A and both real SRTs; every actual household member declares history. */
export async function movieLibraryRollbackBaseline(
  bytes: Uint8Array,
): Promise<MovieRollbackOriginBaseline> {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  const directories: string[] = [];
  const close = async () => {
    await cluster.close();
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  };
  try {
    const source = await libraryBindingFixture(
      db,
      "directors_cut",
      (directory) => directories.push(directory),
      {
        bytes,
        memberAccountId: "710002",
        canonicalStorage: true,
        actualMovieExclusion: true,
        movieMetadata: {
          year: 2020,
          runtimeMinutes: 1,
          originalLanguage: "en",
        },
        initialSidecars: ["en", "zh-Hans"].map((language) => ({
          language,
          bytes: Buffer.from(
            `1\n00:00:00,000 --> 00:00:01,500\nOriginal adopted ${language} dialogue.\n`,
          ),
        })),
      },
    );
    const owner = await authenticateMovieFixtureOwner(
      source.context,
      source.network.actor,
    );
    const household = [owner];
    const people = await db.mediaUser.findMany({
      where: { id: { not: owner.id } },
      orderBy: { id: "asc" },
      take: 101,
    });
    if (people.length > 100)
      throw new Error(
        "Actual initial library household exceeds its native bound",
      );
    for (const person of people)
      household.push(
        await authenticateMovieFixtureOwner(source.context, person, {
          ownerAccountId: owner.plexAccountId,
        }),
      );
    await mapMovieHistoryAccounts(source.context, owner, household);
    const operation = await db.operation.findUniqueOrThrow({
      where: {
        idempotencyKey: `library-plex:${source.receiptId}:${source.asset.id}:0`,
      },
    });
    expect(
      await verifyLibraryPlexBinding(
        source.context,
        LibraryPlexBindingInputV1Schema.parse(operation.payload),
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "verified" });
    await createOutboxActivities(db, () =>
      Promise.reject(
        new Error("Origin fixture completion must not start another workflow"),
      ),
    ).finishMediaOperation({
      operationId: operation.id,
      status: "completed",
      reason: null,
    });
    const scope = {
      rootMediaId: source.network.media.id,
      mediaId: source.network.media.id,
      edition: "directors_cut" as const,
    };
    await releaseOriginalLibraryHistory(db, {
      scope,
      context: source.context,
      owner,
      household,
    });
    expect(
      await db.mediaRequest.count({ where: { mediaId: scope.mediaId } }),
    ).toBe(0);
    expect(
      await db.movieEditionChoice.count({
        where: { rootMediaId: scope.mediaId },
      }),
    ).toBe(0);
    const receipt = await db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: source.receiptId },
    });
    return {
      kind: "library",
      db,
      scope,
      context: source.context,
      files: source.files,
      actor: owner,
      assetId: source.asset.id,
      close,
      originalParents: async () => ({
        receipt: await db.mediaHandoffReceipt.findUniqueOrThrow({
          where: { id: receipt.id },
        }),
        plan: await db.mediaHandoffPlan.findUniqueOrThrow({
          where: { id: receipt.planId },
        }),
        reviews: await db.recoveryReview.findMany({
          where: { scope: { path: ["scope"], equals: scope } },
          orderBy: { id: "asc" },
        }),
        releases: await db.recoveryReleaseReceipt.findMany({
          where: { review: { scope: { path: ["scope"], equals: scope } } },
          orderBy: { id: "asc" },
        }),
      }),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function releaseOriginalLibraryHistory(
  db: Database,
  input: {
    scope: MovieEditionScope;
    context: MediaAutomationContext;
    owner: MediaActor;
    household: MediaActor[];
  },
) {
  const sections = await input.context.permittedSections();
  const service = new PrismaMovieHistoryReviews(db, {
    keepDays: 7,
    serverMachineId: z.string().min(1).parse(input.context.serverMachineId),
    movieSectionId: sections.movie,
  });
  const selected = {
    mediaId: input.scope.mediaId,
    edition: input.scope.edition,
  };
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: selected },
  });
  const hold = await db.recoveryHold.findUniqueOrThrow({
    where: { mediaId_edition: selected },
  });
  const definition = movieDefinitionRef(
    input.scope.mediaId,
    input.scope.edition,
  );
  const prepared = await service.prepare(input.owner, crypto.randomUUID(), {
    schemaVersion: 3,
    scope: input.scope,
    expected: {
      mediaVersion: media.version,
      targetVersion: target.version,
      holdVersion: hold.version,
      definition: {
        definitionVersion: definition.definitionVersion,
        definitionDigest: definition.definitionDigest,
      },
    },
  });
  const reviewed = MovieHistoryDetailV3Schema.parse(
    await service.detail(input.owner, prepared.recoveryReviewId),
  );
  expect(reviewed.scope.legacyClaims).toEqual([]);
  await service.respond(
    input.owner,
    crypto.randomUUID(),
    prepared.recoveryReviewId,
    {
      schemaVersion: 3,
      scope: input.scope,
      scopeHash: reviewed.scopeHash,
      subjectUserId: input.owner.id,
      definition: reviewed.scope.definition,
      registryVersion: 1,
      declaration: { intent: "no_longer_request" },
      claimAcknowledgements: [],
      acknowledgeMissingHistory: true,
    },
  );
  for (const person of input.household) {
    if (person.id === input.owner.id) continue;
    const view = MovieHistoryPersonalDetailV3Schema.parse(
      await service.detail(person, prepared.recoveryReviewId),
    );
    await service.respond(
      person,
      crypto.randomUUID(),
      prepared.recoveryReviewId,
      {
        schemaVersion: 3,
        scope: view.scope,
        scopeHash: view.scopeHash,
        subjectUserId: person.id,
        definition: view.definition,
        registryVersion: view.registryVersion,
        declaration: { intent: "no_longer_request" },
        claimAcknowledgements: view.subject.claimAcknowledgements,
        acknowledgeMissingHistory: true,
      },
    );
  }
  const ready = MovieHistoryDetailV3Schema.parse(
    await service.detail(input.owner, prepared.recoveryReviewId),
  );
  expect(ready.responses).toHaveLength(input.household.length);
  await service.release(input.owner, crypto.randomUUID(), ready.id, {
    schemaVersion: 3,
    scope: input.scope,
    expectedVersion: ready.version,
    scopeHash: ready.scopeHash,
    responseHash: ready.responseHash,
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
}

/** Actual accepted warning, quarantine, Files restore and fresh Plex rebind precede B. */
export async function movieRestoredRollbackBaseline(
  bytes: Uint8Array,
): Promise<MovieRollbackOriginBaseline> {
  const f = await createRestoredMovieFixture("directors_cut", bytes);
  try {
    expect(
      await publishRestoredMovieToPlexV4(
        f.source.context,
        f.input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "available", reason: null });
    await finalizeMovieRestorationV4(
      f.source.context,
      f.input,
      testPlexBindingExecution(),
    );
    const db = f.db;
    return {
      kind: "restored",
      db,
      scope: f.scope,
      context: f.source.context,
      files: f.source.files.context,
      actor: f.source.user,
      assetId: f.asset.id,
      close: f.close,
      originalParents: async () => ({
        acquisition: await db.operation.findUniqueOrThrow({
          where: { id: f.publicationOperationId },
        }),
        quarantine: await db.operation.findUniqueOrThrow({
          where: { id: f.retentionInput.operationId },
        }),
        restored: await db.operation.findUniqueOrThrow({
          where: { id: f.input.operationId },
        }),
        warnings: await db.applicationEvent.findMany({
          where: { mediaId: f.scope.mediaId, kind: "retention_warning" },
          orderBy: { id: "asc" },
        }),
        deliveries: await db.notificationDelivery.findMany({
          where: {
            event: { mediaId: f.scope.mediaId, kind: "retention_warning" },
          },
          orderBy: { id: "asc" },
        }),
      }),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
