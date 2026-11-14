import { z } from "zod";
import { DateTimeSchema } from "#shared/api.ts";
import { AvailabilitySchema } from "#shared/contract.ts";

/** Calendar dates are civil dates, never instants in the viewer's timezone. */
export const CalendarDateSchema = z.iso.date();
export const CalendarReleaseKindSchema = z.enum([
  "episode",
  "theatrical",
  "digital",
  "physical",
]);
export const SeriesStatusSchema = z.enum([
  "unknown",
  "continuing",
  "ended",
  "cancelled",
]);
export const MovieReleaseDateSchema = z
  .object({
    kind: CalendarReleaseKindSchema.exclude(["episode"]),
    region: z.literal("US"),
    date: CalendarDateSchema.nullable(),
    precision: z.enum(["day", "unknown"]),
  })
  .refine(
    (value) => (value.date === null) === (value.precision === "unknown"),
    {
      message: "A release date must preserve its actual precision",
    },
  );
export type MovieReleaseDate = z.infer<typeof MovieReleaseDateSchema>;
export const CalendarCursorSchema = z.object({
  date: CalendarDateSchema.nullable(),
  id: z.string().min(1).max(100),
});

export const CalendarQuerySchema = z
  .object({
    from: CalendarDateSchema,
    to: CalendarDateSchema,
    kind: z
      .enum(["all", "episode", "theatrical", "digital", "physical"])
      .default("all"),
    status: z.enum(["all", "available", "missing"]).default("all"),
    cursor: z.string().max(512).nullable().default(null),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .refine(
    (value) =>
      value.from <= value.to &&
      Date.parse(value.to) - Date.parse(value.from) <= 93 * 86_400_000,
    {
      message: "Choose a calendar range of at most 94 days",
    },
  )
  .superRefine((value, context) => {
    if (value.cursor === null) return;
    try {
      CalendarCursorSchema.parse(JSON.parse(value.cursor));
    } catch {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Invalid calendar cursor",
      });
    }
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;
export const CalendarEventSchema = z.object({
  id: z.string(),
  mediaId: z.string(),
  rootMediaId: z.string(),
  title: z.string(),
  seriesTitle: z.string().nullable(),
  seasonNumber: z.int().nonnegative().nullable(),
  episodeNumber: z.int().nonnegative().nullable(),
  kind: CalendarReleaseKindSchema,
  region: z.literal("US").nullable(),
  date: CalendarDateSchema.nullable(),
  precision: z.enum(["day", "unknown"]),
  availability: AvailabilitySchema,
  observedAt: DateTimeSchema.nullable(),
});
export const CalendarPageSchema = z.object({
  events: z.array(CalendarEventSchema).max(100),
  nextCursor: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export const RemovalHistoryCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.string().min(1).max(100),
});

export const RemovalHistoryQuerySchema = z
  .object({
    cursor: z.string().max(256).nullable().default(null),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((value, context) => {
    if (value.cursor === null) return;
    try {
      RemovalHistoryCursorSchema.parse(JSON.parse(value.cursor));
    } catch {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Invalid removal history cursor",
      });
    }
  });
export type RemovalHistoryQuery = z.infer<typeof RemovalHistoryQuerySchema>;
export const RemovalHistoryItemSchema = z.object({
  id: z.string(),
  mediaId: z.string(),
  title: z.string(),
  kind: z.enum(["movie", "series", "season", "episode"]),
  edition: z.string(),
  seriesTitle: z.string().nullable(),
  seasonNumber: z.int().nonnegative().nullable(),
  episodeNumber: z.int().nonnegative().nullable(),
  reason: z.enum([
    "owner_removed",
    "temporary_interest_released",
    "watched_by_requesters",
  ]),
  actor: z.enum(["owner", "automatic"]),
  requesterContext: z.enum(["your_request", "household"]),
  state: z.enum(["quarantined", "purged", "restored", "cancelled"]),
  quarantinedAt: DateTimeSchema,
  purgedAt: DateTimeSchema.nullable(),
  restoreDeadline: DateTimeSchema.nullable(),
  restoreState: z.enum(["recoverable", "restored", "reacquire", "unavailable"]),
});
export const RemovalHistoryPageSchema = z.object({
  items: z.array(RemovalHistoryItemSchema).max(100),
  nextCursor: z.string().nullable(),
});
export type RemovalHistoryItem = z.infer<typeof RemovalHistoryItemSchema>;
