import { z } from "zod";

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
  status: z.enum(["live", "scheduled"]),
  startsAt: z.iso.datetime().nullable(),
  pageUrl: z.url(),
});
export type SportsEvent = z.infer<typeof SportsEventSchema>;

export type SportsSearchResult =
  | { readonly kind: "found"; readonly events: readonly SportsEvent[] }
  | { readonly kind: "upcoming"; readonly event: SportsEvent }
  | { readonly kind: "ambiguous"; readonly events: readonly SportsEvent[] }
  | { readonly kind: "not-found" };

export type SportsCatalog = {
  readonly listToday: (signal: AbortSignal) => Promise<readonly SportsEvent[]>;
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
  }>;
};
