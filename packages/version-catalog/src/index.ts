import { z } from "zod";

export const VersionCatalogManagementSchema = z.discriminatedUnion("managed", [
  z
    .object({
      managed: z.literal(true),
      datasource: z.string().min(1),
      versioning: z.string().min(1),
      registryUrl: z.url().optional(),
      packageName: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ managed: z.literal(false) }).strict(),
]);

export const VersionCatalogEntrySchema = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
    category: z.enum(["upstream", "internal-image"]),
    artifactType: z.enum(["image", "helm-chart", "package", "source"]),
    management: VersionCatalogManagementSchema,
    notes: z.array(z.string().min(1)).optional(),
    releaseNotesOverride: z
      .object({
        url: z.url().optional(),
        summary: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const VersionCatalogSchema = z
  .object({
    $schema: z.string().min(1),
    schemaVersion: z.literal(1),
    entries: z.array(VersionCatalogEntrySchema).min(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const names = new Set(catalog.entries.map((entry) => entry.name));
    if (names.size !== catalog.entries.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "version catalog names must be unique",
      });
    }
  });

export type VersionCatalog = z.infer<typeof VersionCatalogSchema>;
export type VersionCatalogEntry = z.infer<typeof VersionCatalogEntrySchema>;

export function parseVersionCatalog(raw: unknown): VersionCatalog {
  return VersionCatalogSchema.parse(raw);
}

export function parseVersionCatalogText(text: string): VersionCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error("version catalog is not valid JSON", { cause: error });
  }
  return parseVersionCatalog(raw);
}

function canonicalManagement(management: VersionCatalogEntry["management"]) {
  if (!management.managed) {
    return { managed: false };
  }
  return {
    managed: true,
    datasource: management.datasource,
    ...(management.registryUrl === undefined
      ? {}
      : { registryUrl: management.registryUrl }),
    versioning: management.versioning,
    ...(management.packageName === undefined
      ? {}
      : { packageName: management.packageName }),
  };
}

/** Serialize in the field order consumed by Renovate's regex manager. */
export function serializeVersionCatalog(catalog: VersionCatalog): string {
  const canonical = {
    $schema: catalog.$schema,
    schemaVersion: catalog.schemaVersion,
    entries: catalog.entries.map((entry) => ({
      name: entry.name,
      category: entry.category,
      artifactType: entry.artifactType,
      management: canonicalManagement(entry.management),
      value: entry.value,
      ...(entry.notes === undefined ? {} : { notes: entry.notes }),
      ...(entry.releaseNotesOverride === undefined
        ? {}
        : { releaseNotesOverride: entry.releaseNotesOverride }),
    })),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function versionCatalogMap(
  catalog: VersionCatalog,
): Record<string, string> {
  return Object.fromEntries(
    catalog.entries.map((entry) => [entry.name, entry.value]),
  );
}
