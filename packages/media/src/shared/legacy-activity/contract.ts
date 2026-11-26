import { z } from "zod";

export const LegacyActivitySourceSchema = z.enum([
  "sonarr",
  "radarr",
  "bazarr",
]);
export const legacyActivitySourceLabel = {
  sonarr: "Sonarr",
  radarr: "Radarr",
  bazarr: "Bazarr",
} as const;

const sourceId = z.int().nonnegative();
const common = {
  sourceInstanceId: z.uuid(),
  originalId: z.int().positive(),
  sourceDate: z.iso.datetime({ offset: true }),
  provider: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9 ]{0,23}$/u)
    .nullable(),
};
const manager = {
  ...common,
  table: z.literal("history"),
  action: z.enum([
    "grabbed",
    "downloadFailed",
    "downloadFolderImported",
    "downloadIgnored",
    "episodeFileDeleted",
    "episodeFileRenamed",
    "movieFileDeleted",
    "movieFileRenamed",
    "movieFolderImported",
  ]),
  actionCode: sourceId.nullable(),
  fileId: sourceId.nullable(),
  qualityId: sourceId.nullable(),
  customFormatScore: z.int().nullable(),
};

export const LegacyActivityEventSchema = z.discriminatedUnion("source", [
  z.strictObject({
    ...manager,
    source: z.literal("sonarr"),
    seriesId: sourceId.nullable(),
    episodeId: sourceId.nullable(),
  }),
  z.strictObject({
    ...manager,
    source: z.literal("radarr"),
    movieId: sourceId.nullable(),
  }),
  z.strictObject({
    ...common,
    source: z.literal("bazarr"),
    table: z.enum(["episode", "movie"]),
    action: z.int().nonnegative(),
    mediaId: sourceId.nullable(),
    seriesId: sourceId.nullable(),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?::(?:forced|hi))?$/u)
      .nullable(),
    score: z.int().nullable(),
    scoreOutOf: z.int().nullable(),
    upgradedFromId: sourceId.nullable(),
  }),
]);
export type LegacyActivityEvent = z.infer<typeof LegacyActivityEventSchema>;

export const LEGACY_ACTIVITY_BATCH_SIZE = 500;
export const LEGACY_ACTIVITY_PAGE_SIZE = 50;
export const LEGACY_ACTIVITY_EVENT_KIND = "legacy_activity";
export const LegacyActivityImportSchema = z.strictObject({
  kind: z.literal(LEGACY_ACTIVITY_EVENT_KIND),
  events: z
    .array(LegacyActivityEventSchema)
    .min(1)
    .max(LEGACY_ACTIVITY_BATCH_SIZE),
});
export type LegacyActivityImport = z.infer<typeof LegacyActivityImportSchema>;

export const LegacyActivityQuerySchema = z.strictObject({
  source: z.union([z.literal("imported"), LegacyActivitySourceSchema]),
  before: z.uuid().optional(),
});
export type LegacyActivityQuery = z.infer<typeof LegacyActivityQuerySchema>;

export const LegacyActivityPageSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.uuid(),
      event: LegacyActivityEventSchema,
      media: z.strictObject({ id: z.uuid(), title: z.string() }).optional(),
    }),
  ),
  nextCursor: z.uuid().nullable(),
});
export type LegacyActivityPage = z.infer<typeof LegacyActivityPageSchema>;

export function legacyActivityKey(event: LegacyActivityEvent): string {
  return `legacy_activity:${event.source}:${event.sourceInstanceId}:${event.table}:${String(event.originalId)}`;
}
