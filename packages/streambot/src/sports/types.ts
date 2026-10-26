import { z } from "zod";
import { SportsArtworkSchema } from "./artwork.ts";

export const SportsProviderSchema = z.enum([
  "streameast",
  "tvsportslive",
  "lolesports",
]);
export type SportsProvider = z.infer<typeof SportsProviderSchema>;
export const SportsProviderPreferenceSchema = z.enum([
  "auto",
  "streameast",
  "tvsportslive",
  "lolesports",
]);
export type SportsProviderPreference = z.infer<
  typeof SportsProviderPreferenceSchema
>;

export const SportsEventSchema = z.strictObject({
  id: z.string().min(1),
  provider: SportsProviderSchema,
  title: z.string().min(1),
  status: z.enum(["live", "scheduled", "unknown"]),
  startsAt: z.iso.datetime().nullable(),
  pageUrl: z.url(),
  artwork: SportsArtworkSchema.optional(),
  lol: z
    .strictObject({
      eventId: z.string().regex(/^\d+$/),
      league: z.enum([
        "lck",
        "worlds",
        "msi",
        "first_stand",
        "lpl",
        "lec",
        "lcs",
      ]),
      bestOf: z.number().int().positive(),
    })
    .optional(),
});
export type SportsEvent = z.infer<typeof SportsEventSchema>;

export type SportsSearchResult =
  | { readonly kind: "found"; readonly events: readonly SportsEvent[] }
  | { readonly kind: "upcoming"; readonly event: SportsEvent }
  | { readonly kind: "ambiguous"; readonly events: readonly SportsEvent[] }
  | { readonly kind: "not-found" };

export type SportsCatalog = {
  readonly listSchedule?: (
    signal: AbortSignal,
    options: {
      readonly league?: string;
      readonly range?: "today" | "week";
      readonly timeZone?: string;
    },
  ) => Promise<readonly SportsEvent[]>;
  readonly listToday: (
    signal: AbortSignal,
    provider?: SportsProviderPreference,
  ) => Promise<readonly SportsEvent[]>;
  readonly search: (
    query: string,
    provider: SportsProvider | "auto",
    signal: AbortSignal,
  ) => Promise<SportsSearchResult>;
};

export type SportsResolver = {
  readonly resolve: (
    sourceUrl: string,
    signal: AbortSignal,
  ) => Promise<{
    readonly title: string;
    readonly input: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly inputOptions?: readonly string[];
  }>;
};
