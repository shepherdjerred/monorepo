import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";
import type { MediaProbe } from "#filesystem/media-tools.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";

export type Transaction = Prisma.TransactionClient;
export type FileContext = {
  db: Database;
  roots: { movies: MediaFileRoots; tv: MediaFileRoots };
  checkpoint: (phase: string) => Promise<void>;
  now?: () => Date;
  enabled: {
    acquisition: () => Promise<boolean>;
    quarantine: () => Promise<boolean>;
    purge: () => Promise<boolean>;
  };
  inspect?: (path: string) => Promise<MediaProbe>;
  minimumFreeBytes?: number;
  contentProof?: ContentProof;
  verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
};
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
export const FilePlanSchema = z.array(FilePlanEntrySchema).min(1);
export type FilePlanEntry = z.infer<typeof FilePlanEntrySchema>;
export const RemovalEntrySchema = z.object({
  assetId: z.string(),
  assetVersion: z.number().int(),
  libraryKind: z.enum(["movies", "tv"]),
  libraryPath: z.string(),
  checksum: z.string(),
  quarantineId: z.string(),
  mediaIds: z.array(z.string()).min(1),
  generations: GenerationsSchema,
  sidecars: z.array(
    z.object({
      subtitleId: z.string(),
      libraryPath: z.string(),
      checksum: z.string(),
      quarantineId: z.string(),
    }),
  ),
});
export const RemovalPlanSchema = z.object({
  assets: z.array(RemovalEntrySchema).min(1),
});
export type RemovalEntry = z.infer<typeof RemovalEntrySchema>;
export class FileGuardError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "FileGuardError";
  }
}
export function now(context: FileContext): Date {
  return context.now?.() ?? new Date();
}
