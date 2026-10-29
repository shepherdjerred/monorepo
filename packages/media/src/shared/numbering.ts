import { z } from "zod";
export const EpisodeNumberingSchema = z.object({
  absoluteNumber: z.number().int().positive().optional(),
  numberingEvidence: z.string().optional(),
});
export const SaveEpisodeNumberingSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    absoluteNumber: z.number().int().positive().nullable(),
    evidence: z.string().trim().min(10).max(2000),
  })
  .strict();
export type SaveEpisodeNumbering = z.infer<typeof SaveEpisodeNumberingSchema>;
export const NumberingSeriesListSchema = z.array(
  z.object({ id: z.string(), title: z.string(), year: z.number().nullable() }),
);
export const NumberingEpisodeListSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    seasonNumber: z.number(),
    episodeNumber: z.number(),
    version: z.number(),
    absoluteNumber: z.number().nullable(),
    evidence: z.string().nullable(),
  }),
);
