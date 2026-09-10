import { z } from "zod/v4";
import {
  DiscordSnowflakeSchema,
  IsoTimestampSchema,
  Sha256Schema,
} from "./glitter-corpus.ts";

export const SeedImportManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    importedAt: IsoTimestampSchema,
    archivePath: z.string().min(1),
    archiveSha256: Sha256Schema,
    guildId: DiscordSnowflakeSchema,
    guildSlug: z.string().min(1),
    archiveRoots: z.array(z.string().min(1)).min(1),
    csvFileCount: z.number().int().positive(),
    observationCount: z.number().int().positive(),
    uniqueMessageCount: z.number().int().positive(),
    duplicateMessageCount: z.number().int().nonnegative(),
    firstTimestamp: IsoTimestampSchema,
    lastTimestamp: IsoTimestampSchema,
    channelIds: z.array(DiscordSnowflakeSchema),
    authorIds: z.array(DiscordSnowflakeSchema),
    projectionSha256: Sha256Schema,
  })
  .strict();
export type SeedImportManifest = z.infer<typeof SeedImportManifestSchema>;
