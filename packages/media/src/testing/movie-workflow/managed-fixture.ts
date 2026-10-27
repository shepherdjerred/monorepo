import path from "node:path";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { automationTestHarness } from "#testing/automation.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { movieWorkflowWire } from "./wire.ts";
import { queueLibraryMovieDue } from "#automation/reconciliation/library-movies.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { z } from "zod";

/** Real owner approval/adoption and binding, followed by a new Media-owned upgrade with no personal request. */
export async function createManagedMovieFixture(
  h: Pick<ReturnType<typeof automationTestHarness>, "database">,
  edition: MovieEditionKey,
  ownedDirectory: (directory: string) => void,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const db = h.database();
  const f = await libraryBindingFixture(db, edition, ownedDirectory, {
    bytes: bytes.original,
  });
  const media = await db.mediaItem.update({
    where: { id: f.network.media.id },
    data: { year: 2020, runtimeMinutes: 1, originalLanguage: "en" },
  });
  const operation = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
  });
  const binding = await verifyLibraryPlexBinding(
    f.context,
    LibraryPlexBindingInputV1Schema.parse(operation.payload),
    testPlexBindingExecution(),
  );
  if (binding.status !== "verified")
    throw new Error("Actual managed library binding failed");
  const roots = f.files.roots.movies;
  const mapping = f.files.pathMapping;
  if (mapping === undefined)
    throw new Error("Actual managed fixture lost canonical mapping");
  f.files.pathMapping = {
    canonical: (kind, root, relative) =>
      mapping.canonical(kind, root, relative),
    local: (stored) =>
      stored.startsWith("/downloads/")
        ? path.join(roots.downloads, stored.slice("/downloads/".length))
        : mapping.local(stored),
  };
  const item = f.item();
  const part = item.Media?.[0]?.Part[0];
  if (part === undefined) throw new Error("Actual adopted Part missing");
  const wire = movieWorkflowWire(db, {
    mediaId: f.network.media.id,
    edition,
    title: media.title,
    year: z.number().parse(media.year),
    downloads: roots.downloads,
    bytes: bytes.upgrade,
    resolution: 2160,
    sceneStyle: true,
    providerReleaseId: `synthetic-managed-release:${media.id}:${edition}`,
    ratingKey: item.ratingKey,
    partId: part.id,
    playback: { viewCount: 3, lastViewedAt: 1_234_567, viewOffset: 456_000 },
  });
  const context = { ...f.context, ...wire };
  await db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    update: { enabled: true },
  });
  const scope = {
    rootMediaId: f.network.media.id,
    mediaId: f.network.media.id,
    edition,
  };
  const operationId = await queueLibraryMovieDue(context, scope);
  if (operationId === null)
    throw new Error("Actual approved library policy did not queue monitoring");
  const queued = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const input = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(queued.payload),
  );
  return {
    ...f,
    input,
    scope,
    context,
    wire,
    movie: createMovieNetworkFacetV4(context),
    fileMovie: createMovieFileFacetV4(f.files),
  };
}
