import { z } from "zod";
import { SportsArtworkSchema } from "./artwork.ts";

export const SportsProviderSchema = z.enum(["streameast", "tvsportslive"]);
export type SportsProvider = z.infer<typeof SportsProviderSchema>;
export const SportsProviderPreferenceSchema = z.enum([
  "auto",
  "streameast",
  "tvsportslive",
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
});
export type SportsEvent = z.infer<typeof SportsEventSchema>;

export type SportsSearchResult =
  | { readonly kind: "found"; readonly events: readonly SportsEvent[] }
  | { readonly kind: "upcoming"; readonly event: SportsEvent }
  | { readonly kind: "ambiguous"; readonly events: readonly SportsEvent[] }
  | { readonly kind: "not-found" };

export type SportsCatalog = {
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
