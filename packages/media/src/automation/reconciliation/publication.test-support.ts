import type { Database } from "#infrastructure/database.ts";
import { defaultScope } from "#shared/editions/scope.ts";

/** Build real canonical ancestry when a movie fixture is reused as an episode. */
export async function publicationSeries(db: Database, mediaId: string) {
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Publication series",
      editionDefinitions: {
        create: {
          key: "default",
          policy: "standard_unmarked",
          pathLabel: "",
          plexLabel: "",
          displayLabel: "No specific edition",
        },
      },
    },
  });
  await db.mediaItem.update({
    where: { id: mediaId },
    data: { parentId: series.id },
  });
  await db.mediaIntent.update({
    where: { mediaId_edition: defaultScope(mediaId) },
    data: { editionRootId: series.id },
  });
  return series;
}
