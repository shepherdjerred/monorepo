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
    imagePublisher: z.enum(["ci", "local"]).optional(),
    /**
     * The pinned version is an independently selectable Delivery component:
     * every main pipeline acquires it as an upstream artifact verified against
     * the upstream's published checksum (chart index digest or image manifest
     * digest). Omitted means false; the version rides inside a first-party
     * chart instead.
     */
    component: z.boolean().optional(),
    notes: z.array(z.string().min(1)).optional(),
    releaseNotesOverride: z
      .object({
        url: z.url().optional(),
        summary: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.imagePublisher !== undefined &&
      (entry.category !== "internal-image" || entry.artifactType !== "image")
    ) {
      context.addIssue({
        code: "custom",
        path: ["imagePublisher"],
        message: "imagePublisher requires an internal image entry",
      });
    }
    if (
      entry.component === true &&
      (entry.category !== "upstream" ||
        (entry.artifactType !== "image" &&
          entry.artifactType !== "helm-chart") ||
        !entry.management.managed ||
        entry.management.registryUrl === undefined ||
        (entry.artifactType === "image" &&
          !/^[^@\s]+@sha256:[a-f0-9]{64}$/u.test(entry.value)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["component"],
        message:
          "component entries are managed upstream charts or digest-pinned images with a registryUrl",
      });
    }
  });

/** Entries acquired as Delivery components, in catalog order. */
export function componentEntries(
  catalog: VersionCatalog,
): VersionCatalogEntry[] {
  return catalog.entries.filter((entry) => entry.component === true);
}

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
      ...(entry.imagePublisher === undefined
        ? {}
        : { imagePublisher: entry.imagePublisher }),
      ...(entry.component === undefined ? {} : { component: entry.component }),
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
