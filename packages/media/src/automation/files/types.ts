import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";
import type { MediaProbe } from "#filesystem/media-tools.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { MediaPathMapping } from "#filesystem/media-paths.ts";
import * as filePlan from "#shared/file-plan.ts";

export type Transaction = Prisma.TransactionClient;
export type FileContext = {
  db: Database;
  serverMachineId?: string;
  roots: { movies: MediaFileRoots; tv: MediaFileRoots };
  pathMapping?: MediaPathMapping;
  checkpoint: (phase: string) => Promise<void>;
  publicationExecution?: () => {
    signal: AbortSignal;
    assertActive: () => void;
    checkpoint: () => Promise<void>;
  };
  verifyStorageAuthority: (roots: MediaFileRoots) => Promise<void>;
  now?: () => Date;
  enabled: {
    acquisition: () => Promise<boolean>;
    quarantine: () => Promise<boolean>;
    purge: () => Promise<boolean>;
  };
  inspect?: (path: string) => Promise<MediaProbe>;
  minimumFreeBytes?: number;
  contentProof?: ContentProof;
  preparedEmbedded?: ReadonlyMap<
    string,
    { path: string; checksum: string; bytes: Uint8Array }
  >;
  verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
};
export const GenerationsSchema = filePlan.GenerationsSchema;
export const EmbeddedSubtitleSchema = filePlan.EmbeddedSubtitleSchema;
export const FilePlanEntrySchema = filePlan.FilePlanEntrySchema;
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
