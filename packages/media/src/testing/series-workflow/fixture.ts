import { z } from "zod";
import path from "node:path";
import { managedSeriesWire } from "#testing/series-workflow/wire.ts";
import { libraryTvBindingFixture } from "#automation/plex-binding/library-tv.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";

import type { Database } from "#infrastructure/database.ts";

/** Actual library approval and binding, followed by a newly owned transfer. Only remote wires are synthetic. */
export async function createManagedSeriesFixture(
  db: Database,
  directoryCreated: (directory: string) => void,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await libraryTvBindingFixture(db, directoryCreated, {
    bytes: bytes.original,
    qualitySourceId: "5",
    title: `Synthetic Anime ${crypto.randomUUID()}`,
  });
  await db.mediaItem.update({
    where: { id: f.series.id },
    data: { year: 2020, originalLanguage: "en" },
  });
  const ids = f.episodes.map((episode) => episode.id);
  await db.mediaItem.updateMany({
    where: { id: { in: ids } },
    data: { runtimeMinutes: 1, originalLanguage: "en" },
  });
  const binding = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
  });
  const bound = await verifyLibraryPlexBinding(
    f.context,
    LibraryPlexBindingInputV1Schema.parse(binding.payload),
    testPlexBindingExecution(),
  );
  if (bound.status !== "verified" || bound.bindingCount !== 2)
    throw new Error("Actual library TV binding failed");
  const wire = managedSeriesWire(db, {
    seriesId: f.series.id,
    mediaIds: ids,
    title: f.series.title,
    downloads: f.files.roots.tv.downloads,
    bytes: bytes.upgrade,
    items: f.wire.items,
    show: f.wire.show,
  });
  const context = { ...f.context, ...wire };
  const files = f.files;
  files.pathMapping = {
    canonical: (kind, root, relative) =>
      root === "downloads"
        ? path.join("/downloads", relative)
        : path.join(
            `/data/${kind}`,
            root === "control" ? ".media-control" : "",
            relative,
          ),
    local: (stored) => {
      if (stored.startsWith("/downloads/"))
        return path.join(
          files.roots.tv.downloads,
          stored.slice("/downloads/".length),
        );
      for (const kind of ["movies", "tv"] as const)
        for (const root of ["control", "library"] as const) {
          const prefix =
            root === "control"
              ? `/data/${kind}/.media-control/`
              : `/data/${kind}/`;
          if (stored.startsWith(prefix))
            return path.join(
              files.roots[kind][root],
              stored.slice(prefix.length),
            );
        }
      return stored;
    },
  };
  await db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    update: { enabled: true },
  });
  await createSweepActivities(context).sweepMediaWork({
    kind: "due",
    cursor: null,
    sweepId: crypto.randomUUID(),
  });
  const operation = await db.operation.findFirstOrThrow({
    where: { targetId: z.uuid().parse(ids[0]), kind: "reconcile_media" },
    orderBy: { createdAt: "desc" },
  });
  const input = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const acquired = createAcquisitionActivities(context);
  return {
    ...f,
    db,
    ids,
    wire,
    context,
    files,
    input,
    acquired,
    physical: createMediaFileActivities(files),
    publication: createPublicationActivities(context),
    reserve: async () => {
      const result = await acquired.reconcileMediaIntent(input);
      if (result.status !== "acquire" || result.attemptId === null)
        throw new Error(
          `Actual managed episode did not reserve: ${JSON.stringify(result)}`,
        );
      return { attemptId: result.attemptId, operationId: input.operationId };
    },
  };
}
