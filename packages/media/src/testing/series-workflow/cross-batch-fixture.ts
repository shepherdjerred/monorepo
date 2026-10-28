import path from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { createManagedSeriesFixture } from "./fixture.ts";
import { managedSeriesWire } from "./wire.ts";
import { adoptLibraryBindingSource } from "#automation/plex-binding/library.test-fixture.ts";
import { mediaFixture } from "#migration/bundle-test-fixtures.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import type { PlexItem } from "#integrations/plex.ts";

type Fixture = Awaited<ReturnType<typeof createManagedSeriesFixture>>;

/** Another real capture/report/approval/adoption extends the same series. */
export async function extendManagedSeriesBatch(
  f: Fixture,
  upgrade: Uint8Array,
  layout: "existing_groups" | "merged" = "existing_groups",
) {
  const target = path.join(
    f.files.roots.tv.library,
    `${f.series.title}.S01E03-E04.mkv`,
  );
  await writeFile(target, f.bytes, { flag: "wx" });
  const root = mediaFixture("1", "series", {
    tmdb: z.number().parse(f.series.tmdbId),
  });
  const episodes = [];
  const items: PlexItem[] = [];
  const rootKey = z
    .number()
    .int()
    .positive()
    .parse(Number(f.plexShow.ratingKey));
  const parentRatingKey = z.string().parse(f.plexItems[0]?.parentRatingKey);
  for (const number of [3, 4]) {
    const episode = await f.db.mediaItem.create({
      data: {
        kind: "episode",
        title: `Episode ${String(number)}`,
        parentId: f.series.id,
        seasonNumber: 1,
        episodeNumber: number,
        runtimeMinutes: 1,
        originalLanguage: "en",
      },
    });
    episodes.push(episode);
    items.push({
      ratingKey: String(rootKey + 1 + number),
      type: "episode",
      title: episode.title,
      librarySectionID: 2,
      grandparentRatingKey: f.plexShow.ratingKey,
      parentRatingKey,
      parentIndex: 1,
      index: number,
      Media: [
        {
          Part: [
            {
              id: rootKey + 9999 + number,
              file: target,
              size: Buffer.byteLength(f.bytes),
            },
          ],
        },
      ],
    });
  }
  await f.db.mediaItem.update({
    where: { id: f.series.id },
    data: { version: { increment: 1 } },
  });
  const originalMetadata = f.network.context.plex.metadata.bind(
    f.network.context.plex,
  );
  f.network.context.plex.libraryPage = () =>
    Promise.resolve({ total: items.length, items });
  f.network.context.plex.metadata = (key) => {
    if (key === f.plexShow.ratingKey) return Promise.resolve(f.plexShow);
    const item = items.find((candidate) => candidate.ratingKey === key);
    return item === undefined ? originalMetadata(key) : Promise.resolve(item);
  };
  const adopted = await adoptLibraryBindingSource(f.handoff, {
    kind: "tv",
    edition: "default",
    targetPath: target,
    qualitySourceId: "5",
    media: [
      root,
      ...episodes.map((episode) => ({
        ...root,
        sourceId: `episode:${String(episode.episodeNumber)}`,
        mediaKind: "episode" as const,
        externalIds: {},
        parentSourceId: root.sourceId,
        season: 1,
        episode: episode.episodeNumber,
      })),
    ],
  });
  const ids = [...f.ids, ...episodes.map((episode) => episode.id)];
  const wire = managedSeriesWire(f.db, {
    seriesId: f.series.id,
    mediaIds: ids,
    title: f.series.title,
    downloads: f.files.roots.tv.downloads,
    bytes: upgrade,
    items: [...f.plexItems, ...items],
    show: f.plexShow,
    episodeSpan: { season: 1, first: 1, last: 4 },
    ...(layout === "merged"
      ? {}
      : {
          members: [
            { season: 1, first: 1, last: 2, bytes: upgrade },
            { season: 1, first: 3, last: 4, bytes: upgrade },
          ],
        }),
  });
  const context = { ...f.context, ...wire };
  const operation = await f.db.operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `library-plex:${adopted.receiptId}:${adopted.asset.id}:0`,
    },
  });
  const binding = await verifyLibraryPlexBinding(
    context,
    LibraryPlexBindingInputV1Schema.parse(operation.payload),
    testPlexBindingExecution(),
  );
  if (binding.status !== "verified" || binding.bindingCount !== 2)
    throw new Error("Actual second-batch episode binding failed");
  return {
    ...adopted,
    target,
    ids,
    episodes,
    context,
    wire,
    acquired: createAcquisitionActivities(context),
    publication: createPublicationActivities(context),
  };
}
