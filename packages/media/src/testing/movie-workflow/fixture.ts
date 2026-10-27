import { randomBytes } from "node:crypto";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import {
  grantTestLease,
  grantTestRequesterAccess,
} from "#testing/authority.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { CredentialCipher } from "#application/security.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { captionProviderFixture } from "#automation/movie-editions/notifications/caption-provider.test-fixture.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { movieWorkflowFiles } from "./files.ts";
import { movieWorkflowWire } from "./wire.ts";

/** Full producer journey starts at real consent/outbox, before any attempt, torrent or file publication. */
export async function createMovieWorkflowFixture(
  edition: MovieEditionKey,
  options: { missingEnglish?: boolean } = {},
) {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  let files: Awaited<ReturnType<typeof movieWorkflowFiles>> | undefined;
  try {
    await grantTestLease(db);
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true },
    });
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Synthetic owner",
        role: "owner",
      },
    });
    const user = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Synthetic requester",
      },
    });
    await grantTestRequesterAccess(db, user.id, "fixture-server");
    const media = await db.mediaItem.create({
      data: {
        kind: "movie",
        title: "Workflow Fixture",
        year: 2020,
        tmdbId: 101_010,
        runtimeMinutes: 1,
        originalLanguage: "en",
      },
    });
    const rules = {
      qualities: ["WEB-1080p", "WEB-2160p"],
      rejectedCodecs: [],
      requiredAudioLanguages: ["en"],
      minimumBytes: 1,
      maximumBytes: 10_000_000,
      minimumScore: 0,
      tagScores: {},
      cutoffQuality: "WEB-2160p",
      cutoffScore: 0,
    };
    const profile = await db.qualityProfile.create({
      data: {
        name: "Synthetic movie workflow",
        rules,
        versions: { create: { version: 0, rules } },
      },
    });
    await db.qualityProfileDefault.create({
      data: { kind: "movie", profileId: profile.id },
    });
    await db.mediaProvider.create({
      data: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    });
    files = await movieWorkflowFiles(db, owner.id);
    const bytes =
      options.missingEnglish === true
        ? await movieVideoFixture(1920, [])
        : await movieVideoFixture();
    const wire = movieWorkflowWire(db, {
      mediaId: media.id,
      edition,
      downloads: files.roots.movies.downloads,
      bytes,
    });
    const context = {
      ...createAutomationTestContext(
        db,
        new CredentialCipher(randomBytes(32).toString("base64")),
      ),
      ...wire,
    };
    const sources =
      options.missingEnglish === true
        ? await captionProviderFixture(context)
        : undefined;
    const request = await requestTestMovieV4(db, user, media.id, edition);
    const completion = createOutboxActivities(db, () =>
      Promise.reject(new Error("Completion cannot dispatch")),
    );
    const owned = files;
    return {
      input: request.input,
      movie: createMovieNetworkFacetV4(context, sources),
      fileMovie: createMovieFileFacetV4(files.context),
      finishMediaOperation: completion.finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      captionOperations: () =>
        db.operation.findMany({
          where: {
            kind: "acquire_movie_subtitles_v4",
            payload: { path: ["scope", "mediaId"], equals: media.id },
          },
        }),
      evidence: async () => ({
        operation: await db.operation.findUniqueOrThrow({
          where: { id: request.input.operationId },
          include: { outbox: true },
        }),
        attempts: await db.acquisitionAttempt.findMany({
          where: { mediaIds: { has: media.id } },
          include: { reservations: true, torrent: true },
        }),
        assets: await db.libraryAsset.findMany({
          where: { coverage: { some: { mediaId: media.id, edition } } },
          include: { subtitles: true, coverage: true },
        }),
        binding: await db.plexBindingCurrent.findUnique({
          where: { mediaId_edition: { mediaId: media.id, edition } },
        }),
        outbox: await db.outboxCommand.findMany({
          where: { dispatchedAt: null },
          select: { kind: true },
        }),
        adds: wire.additions(),
      }),
      close: async () => {
        try {
          await cluster.close();
        } finally {
          await owned.close();
        }
      },
    };
  } catch (error) {
    try {
      await cluster.close();
    } finally {
      await files?.close();
    }
    throw error;
  }
}
