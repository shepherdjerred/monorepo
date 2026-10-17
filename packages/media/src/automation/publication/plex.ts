import { z } from "zod";
import type { MediaItem } from "#generated/prisma/client.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import { publicationAwait } from "./execution.ts";
import type { Prisma } from "#generated/prisma/client.ts";

export async function publicationSections(
  context: MediaAutomationContext,
  kind: "movie" | "episode",
  execution?: NativeCompensationExecutionContext,
) {
  const allSections = await publicationAwait(execution, () =>
    context.plex.sections(execution?.signal),
  );
  const permitted = await publicationAwait(execution, () =>
    context.permittedSections(),
  );
  return allSections.filter(
    (section) =>
      section.type === (kind === "movie" ? "movie" : "show") &&
      section.key === (kind === "movie" ? permitted.movie : permitted.series),
  );
}

const ScanCheckpointSchema = z.object({
  plexScan: z
    .object({
      sectionId: z.string(),
      scope: z.string().optional(),
      offset: z.number().int().nonnegative(),
      matches: z.array(z.object({ path: z.string(), ratingKey: z.string() })),
    })
    .optional(),
});

/** Existing bounded publication scan checkpoint; stored wire shape remains unchanged. */
export async function findPublished(
  context: MediaAutomationContext,
  input: {
    sectionId: string;
    kind: "movie" | "episode";
    paths: ReadonlySet<string>;
    operationId: string;
    scope: string;
    execution?: NativeCompensationExecutionContext | undefined;
  },
): Promise<Map<string, PlexItem[]>> {
  const { sectionId, kind, paths, operationId } = input;
  const found = new Map<string, PlexItem[]>();
  const operation = await publicationAwait(input.execution, () =>
    context.db.operation.findUniqueOrThrow({
      where: { id: operationId },
    }),
  );
  const stored = ScanCheckpointSchema.parse(operation.result ?? {}).plexScan;
  const checkpoint = stored?.scope === input.scope ? stored : undefined;
  let offset = checkpoint?.sectionId === sectionId ? checkpoint.offset : 0;
  for (const match of checkpoint?.matches ?? [])
    collectPaths(
      found,
      await publicationAwait(input.execution, () =>
        context.plex.metadata(match.ratingKey, input.execution?.signal),
      ),
      paths,
    );
  for (let page = 0; page < 20; page++) {
    const result = await publicationAwait(input.execution, () =>
      context.plex.libraryPage(
        {
          sectionId,
          kind,
          offset,
          limit: 200,
        },
        input.execution?.signal,
      ),
    );
    for (const item of result.items) collectPaths(found, item, paths);
    offset += result.items.length;
    if (offset >= result.total) {
      offset = 0;
      break;
    }
  }
  const matches = [...found].flatMap(([path, items]) =>
    items.map((item) => ({ path, ratingKey: item.ratingKey })),
  );
  const save = (tx: Prisma.TransactionClient) =>
    publicationAwait(
      input.execution,
      () =>
        tx.$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ plexScan: { sectionId, scope: input.scope, offset, matches } })}::jsonb, "updatedAt" = NOW() WHERE id = ${operationId}`,
    );
  if (input.execution === undefined) await save(context.db);
  else
    await publicationAwait(input.execution, () =>
      context.db.$transaction(save),
    );
  return found;
}

function collectPaths(
  found: Map<string, PlexItem[]>,
  item: PlexItem,
  paths: ReadonlySet<string>,
): void {
  for (const part of item.Media?.flatMap((media) => media.Part) ?? []) {
    if (!paths.has(part.file)) continue;
    const items = found.get(part.file) ?? [];
    if (!items.some((existing) => existing.ratingKey === item.ratingKey))
      items.push(item);
    found.set(part.file, items);
  }
}

async function matchesIdentity(
  context: MediaAutomationContext,
  media: MediaItem,
  item: PlexItem,
  execution?: NativeCompensationExecutionContext,
): Promise<boolean> {
  const external = z
    .object({
      imdb: z.string().nullable().optional(),
      seriesTmdb: z.number().optional(),
    })
    .parse(media.externalIds);
  const key =
    media.kind === "episode" && item.grandparentRatingKey !== undefined
      ? item.grandparentRatingKey
      : item.ratingKey;
  const metadata = await publicationAwait(execution, () =>
    context.plex.metadata(key, execution?.signal),
  );
  const identifiers = new Set(metadata.Guid?.map((guid) => guid.id));
  return media.kind === "episode"
    ? external.seriesTmdb !== undefined &&
        identifiers.has(`tmdb://${String(external.seriesTmdb)}`) &&
        item.index === media.episodeNumber &&
        item.parentIndex === media.seasonNumber
    : (media.tmdbId !== null &&
        identifiers.has(`tmdb://${String(media.tmdbId)}`)) ||
        (external.imdb != null && identifiers.has(`imdb://${external.imdb}`));
}

export async function matchedItem(
  context: MediaAutomationContext,
  media: MediaItem,
  candidates: PlexItem[],
  execution?: NativeCompensationExecutionContext,
): Promise<PlexItem | undefined> {
  for (const candidate of candidates) {
    if (
      candidate.type === media.kind &&
      (await matchesIdentity(context, media, candidate, execution))
    )
      return candidate;
  }
  return undefined;
}
