import { z } from "zod";

// Image publishing runs with the root-scripts dependency closure, not the
// cdk8s workspace closure. Validate the catalog projection needed by the
// publisher here so the isolated linker cannot hide a cross-workspace import.
const ImagePinCatalogEntrySchema = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
    category: z.enum(["upstream", "internal-image"]),
    artifactType: z.enum(["image", "helm-chart", "package", "source"]),
    management: z.object({ managed: z.boolean() }).loose(),
  })
  .loose();

const ImagePinCatalogSchema = z
  .object({
    $schema: z.string().min(1),
    schemaVersion: z.literal(1),
    entries: z.array(ImagePinCatalogEntrySchema).min(1),
  })
  .loose()
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

type ManagedImagePin = {
  readonly key: string;
  readonly digest: string;
};

function parseImagePinCatalog(source: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new Error("version catalog is not valid JSON", { cause: error });
  }
  return ImagePinCatalogSchema.parse(raw);
}

export function findManagedImagePin(
  versionCatalogSource: string,
  imageName: string,
): ManagedImagePin | undefined {
  const catalog = parseImagePinCatalog(versionCatalogSource);
  const entries = new Map(catalog.entries.map((entry) => [entry.name, entry]));
  for (const key of [
    `shepherdjerred/${imageName}`,
    `shepherdjerred/${imageName}/beta`,
  ]) {
    const entry = entries.get(key);
    if (
      entry?.category !== "internal-image" ||
      entry.artifactType !== "image"
    ) {
      continue;
    }
    const match = /@(sha256:[a-f\d]{64})$/.exec(entry.value);
    const digest = match?.[1];
    if (digest !== undefined) return { key, digest };
  }
  return undefined;
}

export function resolveManagedImagePins(
  versionCatalogSource: string,
  imageNames: readonly string[],
): readonly { readonly name: string; readonly pin: ManagedImagePin }[] {
  return imageNames.map((name) => {
    const pin = findManagedImagePin(versionCatalogSource, name);
    if (pin === undefined) {
      throw new Error(
        `No managed image pin exists for ghcr.io/shepherdjerred/${name}`,
      );
    }
    return { name, pin };
  });
}
