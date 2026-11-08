import { z } from "zod";
import {
  MigrationBundleSchema,
  BundleReviewSchema,
  CreateBundleSchema,
  CaptureBindingSchema,
  MigrationRootMappingSchema,
} from "#shared/migration-handoff.ts";

export const LibraryCaptureKindSchema = z.enum(["radarr", "sonarr", "bazarr"]);
export const LibraryRootMappingV2Schema = MigrationRootMappingSchema.omit({
  sourceMountIdentity: true,
});
/** A library report needs no requester inventory, torrent association or transfer history. */
export const LibraryMigrationBundleV2Schema = MigrationBundleSchema.extend({
  schemaVersion: z.literal(2),
  purpose: z.literal("initial_library"),
  captures: z
    .array(
      CaptureBindingSchema.extend({ sourceKind: LibraryCaptureKindSchema }),
    )
    .min(1)
    .max(20),
  requiredSources: z.array(LibraryCaptureKindSchema).min(2).max(3),
  rootMappings: z.array(LibraryRootMappingV2Schema).max(100),
  associations: z
    .array(MigrationBundleSchema.shape.associations.element)
    .max(0),
}).refine(
  (manifest) =>
    !manifest.complete ||
    ["radarr", "sonarr"].every((kind) =>
      manifest.captures.some((capture) => capture.sourceKind === kind),
    ),
  "A complete library report requires the movie and TV library sources",
);
export const MigrationBundleProtocolSchema = z.union([
  MigrationBundleSchema,
  LibraryMigrationBundleV2Schema,
]);
export const CreateLibraryBundleV2Schema = CreateBundleSchema.extend({
  schemaVersion: z.literal(2),
  purpose: z.literal("initial_library"),
  rootMappings: z.array(LibraryRootMappingV2Schema).max(100).default([]),
});
export const CreateBundleProtocolSchema = z.union([
  CreateBundleSchema,
  CreateLibraryBundleV2Schema,
]);
export const BundleReviewProtocolSchema = BundleReviewSchema.extend({
  manifest: MigrationBundleProtocolSchema,
});
