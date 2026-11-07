import { z } from "zod";
import { expect } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  movieLibraryRollbackBaseline,
  movieRestoredRollbackBaseline,
} from "./rollback-origin-baselines.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { queueLibraryMovieDue } from "#automation/reconciliation/library-movies.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MoviePublicationIntentV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { PlexClient } from "#integrations/plex.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";

/** The imported Radarr profile requires at least34.5MiB/min for WEB2160p;
 * generate actual padded video bytes rather than overriding its size guard. */
export async function movieRollbackOriginVideos() {
  return {
    original: await movieVideoFixture(),
    upgrade: await movieVideoFixture(3840, undefined, { bitrateKbps: 320_000 }),
  };
}

/** Distinct genuine A parents reach the same B publication and rollback engine without rewritten history. */
export async function createMovieRollbackOriginFixture(
  kind: "library" | "restored",
  videos: { original: Uint8Array; upgrade: Uint8Array },
) {
  const base = await (kind === "library"
    ? movieLibraryRollbackBaseline(videos.original)
    : movieRestoredRollbackBaseline(videos.original));
  try {
    const { db, scope } = base;
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: scope.mediaId },
    });
    const pointer = await db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
      },
    });
    const evidence = await db.plexAssociationEvidence.findUniqueOrThrow({
      where: { id: z.uuid().parse(pointer.evidenceId) },
    });
    const association = PlexMovieAssociationV2Schema.parse(evidence.evidence);
    const part = association.item.media[0].parts[0];
    const originalItem = await base.context.plex.metadata(
      association.item.ratingKey,
    );
    const playback = plexPlayback(originalItem);
    const wire = movieWorkflowWire(db, {
      mediaId: media.id,
      edition: scope.edition,
      title: media.title,
      year: z.number().parse(media.year),
      downloads: base.files.roots.movies.downloads,
      bytes: videos.upgrade,
      resolution: 2160,
      sceneStyle: true,
      providerReleaseId: `synthetic-rollback-origin:${kind}:${media.id}`,
      ratingKey: association.item.ratingKey,
      partId: z.coerce.number().int().positive().parse(part.id),
      ...(playback === null ? {} : { playback }),
    });
    const context = { ...base.context, ...wire };
    expect(await context.plex.machineIdentifier()).toBe(
      base.context.serverMachineId,
    );
    await db.mediaProvider.upsert({
      where: { id: "knaben" },
      create: {
        id: "knaben",
        enabled: true,
        seedingPolicy: { kind: "public" },
      },
      update: { enabled: true },
    });
    let queuedId: string | null;
    if (kind === "library")
      queuedId = await queueLibraryMovieDue(context, scope);
    else {
      const requested = await requestTestMovieV4(
        db,
        base.actor,
        scope.mediaId,
        scope.edition,
      );
      queuedId = requested.input.operationId;
    }
    const command = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(queuedId) },
    });
    const root = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(command.payload),
    );
    const movie = createMovieNetworkFacetV4(context);
    const fileMovie = createMovieFileFacetV4(base.files);
    const acquired = await movie.reconcileMovieIntentV4(
      root,
      testPlexBindingExecution(),
    );
    if (acquired.status !== "acquire")
      throw new Error(
        `Actual ${kind} rollback-origin B selection: ${JSON.stringify(acquired)}`,
      );
    const input = {
      schemaVersion: 4 as const,
      operationId: root.operationId,
      scope,
      attemptId: z.uuid().parse(acquired.attemptId),
    };
    expect(
      await movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
    ).toEqual({ status: "staged" });
    expect(
      await fileMovie.prepareMoviePublicationV4(
        input,
        testPublicationExecution(),
        new PublicationAuthorityReadBudget(),
      ),
    ).toEqual({ status: "prepared" });
    expect(
      await fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    const source = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const plan = MovieFilePlanSchema.parse(source.filePlan);
    const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: input.attemptId },
    });
    const publication = MoviePublicationIntentV2Schema.parse(transition.intent);
    const predecessor = publication.entries[0].predecessor;
    if (predecessor === null)
      throw new Error("Actual rollback origin has no served predecessor");
    const grant = publication.entries[0].originalGrant;
    expect(grant?.kind).toBe(
      kind === "library"
        ? "movie_library_adoption_v2"
        : "movie_restore_publication_v1",
    );
    const state = async () => {
      const assets = await db.libraryAsset.findMany({
        where: { id: { in: [base.assetId, plan.entries[0].assetId] } },
        include: { subtitles: { orderBy: { id: "asc" } } },
        orderBy: { id: "asc" },
      });
      const files = [];
      for (const asset of assets) {
        const content = await readFile(workerFilePath(base.files, asset.path));
        files.push({
          id: asset.id,
          checksum: createHash("sha256").update(content).digest("hex"),
          size: content.byteLength,
        });
        for (const caption of asset.subtitles.filter(
          (row) =>
            row.storageKind === "sidecar" &&
            ["installed", "superseded"].includes(row.state),
        )) {
          const captionBytes = await readFile(
            workerFilePath(base.files, z.string().parse(caption.path)),
          );
          files.push({
            id: caption.id,
            checksum: createHash("sha256").update(captionBytes).digest("hex"),
            size: captionBytes.byteLength,
          });
        }
      }
      return {
        assets,
        files,
        pointer: await db.plexBindingCurrent.findUniqueOrThrow({
          where: {
            mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
          },
        }),
        torrents: await db.torrent.findMany({ orderBy: { id: "asc" } }),
      };
    };
    const sections = await context.permittedSections();
    return {
      ...base,
      context,
      input,
      movie,
      fileMovie,
      wire,
      plan,
      predecessor,
      publication,
      originalItem,
      state,
      rejectedMovie: createMovieNetworkFacetV4({
        ...context,
        plex: rejectedOriginPlex(
          z.string().parse(context.serverMachineId),
          sections.movie,
        ),
      }),
    };
  } catch (error) {
    await base.close();
    throw error;
  }
}

function plexPlayback(raw: unknown) {
  const value = z
    .object({
      viewCount: z.number().optional(),
      lastViewedAt: z.number().optional(),
      viewOffset: z.number().optional(),
    })
    .parse(raw);
  return value.viewCount === undefined &&
    value.lastViewedAt === undefined &&
    value.viewOffset === undefined
    ? null
    : value;
}

function rejectedOriginPlex(serverMachineId: string, movieSection: string) {
  return new PlexClient(
    {
      baseUrl: "http://rollback-origin.fixture",
      token: "synthetic",
      clientIdentifier: "synthetic-origin-rollback",
    },
    (url) => {
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: { machineIdentifier: serverMachineId },
          }),
        );
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 1,
              Directory: [
                { key: movieSection, type: "movie", title: "Movies" },
              ],
            },
          }),
        );
      if (url.pathname === `/library/sections/${movieSection}/refresh`)
        return Promise.resolve(new Response(null, { status: 200 }));
      if (url.pathname === `/library/sections/${movieSection}/all`)
        return Promise.resolve(
          Response.json({
            MediaContainer: { size: 0, totalSize: 0, Metadata: [] },
          }),
        );
      throw new Error(`Unexpected origin rollback Plex route ${url.pathname}`);
    },
  );
}
