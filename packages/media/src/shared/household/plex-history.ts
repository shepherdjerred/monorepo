import { z } from "zod";

export const PLEX_HISTORICAL_VIEW_BATCH_LIMIT = 250;
export const PLEX_HISTORICAL_VIEW_PAGE_SIZE = 50;
export const PLEX_HISTORICAL_VIEW_MAX_BYTES = 2 * 1024 * 1024;

const sourceViewId = z.int().positive();
const source = z.enum(["view", "last_watched"]);
const decimalId = z.string().regex(/^-?(0|[1-9]\d{0,18})$/u);
const date = z.iso.datetime();
const text = z.string().max(1024);

const PlexHistoricalViewFields = z.strictObject({
  source,
  sourceViewId,
  serverAccountId: decimalId,
  sectionId: decimalId.nullable(),
  guid: text.nullable(),
  kind: z.enum(["movie", "episode"]),
  title: text,
  seriesTitle: text.nullable(),
  seriesGuid: text.nullable(),
  seasonNumber: z.int32().nullable(),
  episodeNumber: z.int32().nullable(),
  viewedAt: date,
  originallyAvailableAt: date.nullable(),
  viewType: z.int32().nullable(),
  viewCount: z.int32().positive().nullable(),
});

export const PlexHistoricalViewRowSchema = PlexHistoricalViewFields.refine(
  (row) =>
    row.source === "last_watched"
      ? row.viewType === null && row.viewCount !== null
      : row.viewCount === null,
  "Plex view metadata must match its source",
);

export const PlexHistoricalViewImportSchema = z.strictObject({
  serverMachineId: z.string().min(1).max(128),
  rows: z
    .array(PlexHistoricalViewRowSchema)
    .min(1)
    .max(PLEX_HISTORICAL_VIEW_BATCH_LIMIT),
});

const viewCursor = z
  .string()
  .regex(/^(view|last_watched):[1-9]\d{0,15}$/u)
  .transform((cursor) => {
    const [sourceName, id] = cursor.split(":");
    return { source: sourceName, sourceViewId: Number(id) };
  })
  .pipe(z.object({ source, sourceViewId }));

export const PlexHistoricalViewQuerySchema = z.object({
  cursor: viewCursor.optional(),
});

const PlexHistoricalViewItemSchema = PlexHistoricalViewFields.pick({
  source: true,
  sourceViewId: true,
  kind: true,
  title: true,
  seriesTitle: true,
  seasonNumber: true,
  episodeNumber: true,
  viewedAt: true,
});

export const PlexHistoricalViewsSchema = z.object({
  items: z
    .array(PlexHistoricalViewItemSchema)
    .max(PLEX_HISTORICAL_VIEW_PAGE_SIZE),
  nextCursor: z.string().nullable(),
});

export type PlexHistoricalViewImport = z.infer<
  typeof PlexHistoricalViewImportSchema
>;
export type PlexHistoricalViewQuery = z.infer<
  typeof PlexHistoricalViewQuerySchema
>;
export type PlexHistoricalViews = z.infer<typeof PlexHistoricalViewsSchema>;
