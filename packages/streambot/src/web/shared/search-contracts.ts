import { z } from "zod";
import { SportsArtworkSchema } from "@shepherdjerred/streambot/sports/artwork.ts";
import {
  ArtworkUrlSchema,
  type MediaSelectionSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";

/** One result group per request, so the client can load them independently. */
export const SearchKindSchema = z.enum([
  "songs",
  "albums",
  "artists",
  "library",
  "videos",
  "live",
  "history",
]);
export type SearchKind = z.infer<typeof SearchKindSchema>;

/** Listen is voice audio everyone hears; Watch is a stream people open. */
export const RowActionSchema = z.enum(["listen", "watch"]);
export type RowAction = z.infer<typeof RowActionSchema>;

export const RowKindSchema = z.enum([
  "song",
  "album",
  "artist",
  "library",
  "video",
  "live",
  "history",
  "link",
]);
export type RowKind = z.infer<typeof RowKindSchema>;

export const RowSchema = z.strictObject({
  /** A server-issued selection token bound to the viewer and server; for `link` rows, the URL. */
  id: z.string().min(1),
  kind: RowKindSchema,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  artworkUrl: ArtworkUrlSchema.optional(),
  sportsArtwork: SportsArtworkSchema.optional(),
  /** Live rows only. */
  status: z.enum(["live", "scheduled", "unknown"]).optional(),
  startsAt: z.iso.datetime().optional(),
  /** What this viewer can do with the row, first entry first; empty means browse only. */
  actions: z.array(RowActionSchema),
  /** Further actions the row offers only from its overflow menu; absent when there are none. */
  menuActions: z.array(RowActionSchema).min(1).optional(),
  /** Open this album or artist page instead of playing. */
  browse: z
    .strictObject({ kind: z.enum(["album", "artist"]), id: z.string().min(1) })
    .optional(),
});
export type Row = z.infer<typeof RowSchema>;

export const SearchResponseSchema = z.strictObject({
  kind: SearchKindSchema,
  /** What the provider searched instead of the typed query, when it corrected a typo. */
  correctedQuery: z.string().optional(),
  items: z.array(RowSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SuggestResponseSchema = z.strictObject({
  suggestions: z.array(z.string()).max(8),
});

/** An album or artist page: its header, a selection for the whole album, and its rows. */
export const BrowsePageSchema = z.strictObject({
  header: z.strictObject({
    kind: z.enum(["album", "artist"]),
    id: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    artworkUrl: ArtworkUrlSchema.optional(),
  }),
  /** Albums only: queues every track in order as one play request. */
  play: z
    .strictObject({ id: z.string().min(1), actions: z.array(RowActionSchema) })
    .optional(),
  rows: z.array(RowSchema),
});
export type BrowsePage = z.infer<typeof BrowsePageSchema>;

/** The `play` command selection that redeems a row; `null` for rows that only open a page. */
export function selectionForRow(
  row: Pick<Row, "id" | "kind">,
): z.infer<typeof MediaSelectionSchema> | null {
  // Exhaustive on purpose: a new row kind must say how it is redeemed.
  switch (row.kind) {
    case "song":
      return { kind: "music", id: row.id };
    case "video":
    case "library":
      return { kind: "candidate", id: row.id };
    case "live":
      return { kind: "sports", id: row.id };
    case "history":
      return { kind: "history", id: row.id };
    case "link":
      return { kind: "url", url: row.id };
    case "album":
    case "artist":
      return null;
  }
}
