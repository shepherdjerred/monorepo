import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import {
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PrismaMovieHistoryReviews } from "#infrastructure/movie-editions/history-review/service.ts";
import { movieDefinitionRef } from "#infrastructure/movie-editions/definition.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { mapMovieHistoryAccounts } from "./history-review-accounts.ts";

/** Real owner-approved Files adoption and Plex binding; only external provider/identity boundaries are synthetic. */
export async function createMovieHistoryFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  options: {
    actualMovieExclusion?: boolean;
    canonicalStorage?: boolean;
    movieMetadata?: {
      year: number;
      runtimeMinutes: number;
      originalLanguage: string;
    };
  } = {},
) {
  const cluster = await startMediaTestPostgres();
  const directories: string[] = [];
  const close = async () => {
    await cluster.close();
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  };
  try {
    const db = cluster.database;
    const original = await libraryBindingFixture(
      db,
      edition,
      (directory) => directories.push(directory),
      { bytes, memberAccountId: "710002", ...options },
    );
    const owner = await authenticateMovieFixtureOwner(
      original.context,
      original.network.actor,
    );
    const household = [owner];
    const people = await db.mediaUser.findMany({
      where: { id: { not: owner.id } },
      orderBy: { id: "asc" },
      take: 101,
    });
    if (people.length > 100)
      throw new Error(
        "Actual history fixture household exceeds its native bound",
      );
    for (const person of people)
      household.push(
        await authenticateMovieFixtureOwner(original.context, person, {
          ownerAccountId: owner.plexAccountId,
        }),
      );
    const profileAdmin = await mapMovieHistoryAccounts(
      original.context,
      owner,
      household,
    );
    const sections = await original.context.permittedSections();
    const settings = {
      keepDays: 30,
      serverMachineId: z
        .string()
        .min(1)
        .parse(original.context.serverMachineId),
      movieSectionId: sections.movie,
    };
    const scope = MovieEditionScopeSchema.parse({
      rootMediaId: original.network.media.id,
      mediaId: original.network.media.id,
      edition,
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: {
        idempotencyKey: `library-plex:${original.receiptId}:${original.asset.id}:0`,
      },
    });
    const bound = await verifyLibraryPlexBinding(
      original.context,
      LibraryPlexBindingInputV1Schema.parse(operation.payload),
      testPlexBindingExecution(),
    );
    if (bound.status !== "verified")
      throw new Error(
        "Actual history fixture library Plex binding did not verify",
      );
    const service = new PrismaMovieHistoryReviews(db, settings);
    const commands = new MovieLifecycleCommands(db, settings);
    const prepare = async () => {
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: scope.mediaId },
      });
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: scope.mediaId, edition } },
      });
      const hold = await db.recoveryHold.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: scope.mediaId, edition } },
      });
      const definition = movieDefinitionRef(scope.mediaId, edition);
      const input = {
        schemaVersion: 3 as const,
        scope,
        expected: {
          mediaVersion: media.version,
          targetVersion: target.version,
          holdVersion: hold.version,
          definition: {
            definitionVersion: definition.definitionVersion,
            definitionDigest: definition.definitionDigest,
          },
        },
      };
      const result = await service.prepare(owner, crypto.randomUUID(), input);
      return {
        input,
        result,
        detail: MovieHistoryDetailV3Schema.parse(
          await service.detail(owner, result.recoveryReviewId),
        ),
      };
    };
    const request = async () => {
      const context = await new PrismaMediaApplication(
        db,
        settings,
      ).getMovieEditionContext(owner, scope.mediaId, owner.id);
      const selected = context.options.find(
        (option) => option.edition === edition,
      );
      if (selected === undefined)
        throw new Error("Actual selected cut option disappeared");
      return commands.requestMovieEditionV4(owner, crypto.randomUUID(), {
        schemaVersion: 4,
        mediaId: scope.mediaId,
        subjectUserId: owner.id,
        expected: {
          mediaVersion: context.mediaVersion,
          targetVersion: selected.targetVersion,
          definition: selected.storedDefinition,
          request:
            selected.request === null
              ? null
              : {
                  id: selected.request.id,
                  version: selected.request.version,
                  choiceRevision: selected.request.choiceRevision,
                },
        },
        selection: {
          edition,
          definitionVersion: selected.definitionVersion,
          definitionDigest: selected.definitionDigest,
          registryVersion: context.registryVersion,
        },
        options: { subtitleLanguages: ["en"] },
      });
    };
    const declareRemaining = async (reviewId: string) => {
      const review = MovieHistoryDetailV3Schema.parse(
        await service.detail(owner, reviewId),
      );
      for (const subject of review.scope.users) {
        if (review.responses.some((response) => response.userId === subject.id))
          continue;
        if (subject.id === owner.id)
          throw new Error(
            "Fixture requires the owner's explicit declaration before remaining household responses",
          );
        const person = household.find((actor) => actor.id === subject.id);
        if (person === undefined)
          throw new Error(
            "An actual reviewed person lacks their own authenticated fixture session",
          );
        const visible = MovieHistoryPersonalDetailV3Schema.parse(
          await service.detail(person, reviewId),
        );
        await service.respond(person, crypto.randomUUID(), reviewId, {
          schemaVersion: 3,
          scope: visible.scope,
          scopeHash: visible.scopeHash,
          subjectUserId: person.id,
          definition: visible.definition,
          registryVersion: visible.registryVersion,
          declaration: { intent: "no_longer_request" },
          claimAcknowledgements: visible.subject.claimAcknowledgements,
          acknowledgeMissingHistory: true,
        });
      }
    };
    return {
      db,
      original,
      owner,
      household,
      profileAdmin,
      settings,
      scope,
      service,
      commands,
      prepare,
      request,
      declareRemaining,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
