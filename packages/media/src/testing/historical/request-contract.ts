import { z } from "zod";
import { LanguageSchema } from "#shared/contract.ts";

/** Options physically present in the pre-household movie request contract. */
export const HistoricalMovieOptionsSchema = z.strictObject({
  subtitleLanguages: z.array(LanguageSchema).max(20),
});
