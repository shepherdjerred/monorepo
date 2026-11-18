import { z } from "zod";

export const MAX_SUMMARY_CHARS = 240;

const ROOTS = [
  { plex: "/data/movies/", local: "/media/movies/" },
  { plex: "/data/tv/", local: "/media/tv/" },
] as const;

export const SectionsSchema = z.object({
  MediaContainer: z.object({
    size: z.number().int().nonnegative(),
    Directory: z
      .array(z.object({ key: z.string(), type: z.string() }))
      .optional(),
  }),
});

export const PageSchema = z.object({
  MediaContainer: z.object({
    totalSize: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    Metadata: z
      .array(
        z.object({
          type: z.string().optional(),
          title: z.string().optional(),
          grandparentTitle: z.string().optional(),
          parentIndex: z.number().int().nonnegative().optional(),
          index: z.number().int().nonnegative().optional(),
          year: z.number().int().nonnegative().optional(),
          duration: z.number().nonnegative().optional(),
          summary: z.string().optional(),
          Genre: z.array(z.object({ tag: z.string() })).optional(),
          thumb: z.string().optional(),
          grandparentThumb: z.string().optional(),
          Media: z
            .array(
              z.object({
                Part: z.array(z.object({ file: z.string() })),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
});

export type RawPlexMetadata = NonNullable<
  z.infer<typeof PageSchema>["MediaContainer"]["Metadata"]
>[number];

export type PlexSectionType = "movie" | "show";

export type PlexItemMetadata = {
  readonly sectionType: PlexSectionType;
  readonly type?: string;
  readonly title?: string;
  readonly series?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly year?: number;
  readonly durationSeconds?: number;
  readonly summary?: string;
  readonly genres: readonly string[];
};

export type PlexCatalogIndex = {
  readonly posters: Map<string, string | null>;
  readonly metadata: Map<string, PlexItemMetadata>;
};

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function truncateSummary(
  value: string | undefined,
  maxChars = MAX_SUMMARY_CHARS,
): string | undefined {
  const trimmed = nonEmptyTrimmed(value);
  if (trimmed === undefined) {
    return undefined;
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const sliced = trimmed.slice(0, maxChars);
  return /[\uD800-\uDBFF]$/u.test(sliced) ? sliced.slice(0, -1) : sliced;
}

function normalizeGenres(
  raw: readonly { readonly tag: string }[] | undefined,
): readonly string[] {
  if (raw === undefined || raw.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const genres: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.tag.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = trimmed.toLocaleLowerCase("en-US");
    if (!seen.has(key)) {
      seen.add(key);
      genres.push(trimmed);
    }
  }
  return genres;
}

export function toLocalLibraryPath(plexFile: string): string | null {
  const root = ROOTS.find((candidate) => plexFile.startsWith(candidate.plex));
  return root === undefined
    ? null
    : root.local + plexFile.slice(root.plex.length);
}

export function resolvePlexPosterUrl(thumb: string, baseUrl: string): URL {
  const url = new URL(thumb, baseUrl);
  if (
    !thumb.startsWith("/") ||
    url.origin !== new URL(baseUrl).origin ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/library\/metadata\/[^/]+\/thumb(?:\/[^/]+)?$/u.test(url.pathname)
  ) {
    throw new Error("Plex returned an unsupported poster path");
  }
  return url;
}

export function buildPlexItemMetadata(
  item: RawPlexMetadata,
  sectionType: PlexSectionType,
): PlexItemMetadata {
  const type = nonEmptyTrimmed(item.type);
  const title = nonEmptyTrimmed(item.title);
  const series = nonEmptyTrimmed(item.grandparentTitle);
  const summary = truncateSummary(item.summary);
  const durationSeconds =
    item.duration !== undefined && item.duration > 0
      ? item.duration / 1000
      : undefined;
  const year = item.year !== undefined && item.year > 0 ? item.year : undefined;

  return {
    sectionType,
    ...(type === undefined ? {} : { type }),
    ...(title === undefined ? {} : { title }),
    ...(series === undefined ? {} : { series }),
    ...(item.parentIndex === undefined ? {} : { season: item.parentIndex }),
    ...(item.index === undefined ? {} : { episode: item.index }),
    ...(year === undefined ? {} : { year }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(summary === undefined ? {} : { summary }),
    genres: normalizeGenres(item.Genre),
  };
}

export function indexCatalogItem(options: {
  readonly item: RawPlexMetadata;
  readonly sectionType: PlexSectionType;
  readonly baseUrl: string;
  readonly index: PlexCatalogIndex;
}): void {
  const { item, sectionType, baseUrl, index } = options;
  const thumb =
    (sectionType === "movie" ? item.thumb : item.grandparentThumb) ?? null;
  if (thumb !== null) {
    resolvePlexPosterUrl(thumb, baseUrl);
  }
  const built = buildPlexItemMetadata(item, sectionType);
  const parts = item.Media?.flatMap((media) => media.Part) ?? [];
  for (const part of parts) {
    const local = toLocalLibraryPath(part.file);
    if (local === null) {
      continue;
    }
    if (index.posters.has(local) && index.posters.get(local) !== thumb) {
      throw new Error("Plex returned conflicting posters for one media file");
    }
    index.posters.set(local, thumb);
    if (!index.metadata.has(local)) {
      index.metadata.set(local, built);
    }
  }
}
