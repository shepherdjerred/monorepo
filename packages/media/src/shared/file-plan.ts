import { z } from "zod";
import { DefaultFileIdentityEvidenceSchema } from "./acquisition/tv-file-evidence-v2.ts";

export const GenerationsSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);
export const EmbeddedSubtitleSchema = z.object({
  id: z.string(),
  language: z.enum(["en", "zh-Hans"]),
  relativePath: z.string(),
  checksum: z.string(),
  format: z.enum(["srt", "ass"]),
  streamIndex: z.number().int(),
});
export const FilePlanEntrySchema = z.object({
  identityEvidence: DefaultFileIdentityEvidenceSchema.optional(),
  assetId: z.string(),
  mediaIds: z.array(z.string()).min(1),
  generations: GenerationsSchema,
  libraryKind: z.enum(["movies", "tv"]),
  downloadPath: z.string(),
  libraryPath: z.string(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.string().regex(/^\d+$/u),
  properties: z.json(),
  operationId: z.string(),
  previousAssetId: z.string().nullable(),
  previousChecksum: z.string().nullable(),
  previousVersion: z.number().int().nullable(),
  previousSidecars: z.array(
    z.object({
      subtitleId: z.string(),
      libraryPath: z.string(),
      checksum: z.string(),
      quarantineId: z.string(),
      operationId: z.string(),
    }),
  ),
  embeddedSubtitles: z.array(EmbeddedSubtitleSchema),
});
