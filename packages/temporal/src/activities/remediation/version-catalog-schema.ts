import { z } from "zod/v4";

export const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";

const ManagedEntryManagementSchema = z.strictObject({
  managed: z.literal(true),
  datasource: z.string().min(1),
  versioning: z.string().min(1),
  registryUrl: z.url().optional(),
  packageName: z.string().min(1).optional(),
});

const UnmanagedEntryManagementSchema = z.strictObject({
  managed: z.literal(false),
});

export const ReleaseNotesOverrideSchema = z.strictObject({
  url: z.url().optional(),
  summary: z.string().min(1),
});
export type ReleaseNotesOverride = z.infer<typeof ReleaseNotesOverrideSchema>;

export const StrictCatalogEntrySchema = z
  .strictObject({
    name: z.string().min(1),
    value: z.string().min(1),
    category: z.enum(["upstream", "internal-image"]),
    artifactType: z.enum(["image", "helm-chart", "package", "source"]),
    management: z.discriminatedUnion("managed", [
      ManagedEntryManagementSchema,
      UnmanagedEntryManagementSchema,
    ]),
    imagePublisher: z.enum(["ci", "local"]).optional(),
    component: z.boolean().optional(),
    notes: z.array(z.string().min(1)).optional(),
    releaseNotesOverride: ReleaseNotesOverrideSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (
      entry.imagePublisher !== undefined &&
      (entry.category !== "internal-image" || entry.artifactType !== "image")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["imagePublisher"],
        message: "imagePublisher is permitted only on internal-image entries",
      });
    }
  });
export type StrictCatalogEntry = z.infer<typeof StrictCatalogEntrySchema>;

export const FullCatalogSchema = z.strictObject({
  $schema: z.string().min(1),
  schemaVersion: z.literal(1),
  entries: z.array(StrictCatalogEntrySchema).min(1),
});
export type FullCatalog = z.infer<typeof FullCatalogSchema>;

export const CatalogSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(StrictCatalogEntrySchema),
});
