import { z } from "zod";
import { MigrationTorrentSchema } from "./migration.ts";

/** Reviewed identity and effective source policy exclude changing seeding counters. */
export const NativeTorrentIdentitySchema = MigrationTorrentSchema.omit({
  progress: true,
  ratio: true,
  seededSeconds: true,
  managerAssociations: true,
});
export const NativeTorrentObservationSchema = z.strictObject({
  identity: NativeTorrentIdentitySchema,
});
