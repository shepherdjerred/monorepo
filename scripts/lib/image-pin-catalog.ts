import { asRecord } from "./json.ts";

export const UNPUBLISHED_IMAGE_DIGEST = `sha256:${"0".repeat(64)}`;

type ManagedImagePin = {
  readonly key: string;
  readonly digest: string;
};

type CatalogImageEntry = {
  readonly name: string;
  readonly value: string;
  readonly category: string;
  readonly artifactType: string;
};

function requiredString(
  entry: Record<string, unknown> | null,
  field: string,
  index: number,
): string {
  const value = entry?.[field];
  if (typeof value !== "string") {
    throw new TypeError(
      `version catalog entry ${String(index)} has a non-string ${field}`,
    );
  }
  return value;
}

/**
 * The bake lanes run `bun --no-install .buildkite/scripts/bake-images.ts` in a
 * pod that never installs the workspace, so this reader must stay on platform
 * primitives. A Zod-backed schema here makes every bake pod fail at module load
 * with "Cannot find package 'zod'" — moving the module between workspaces does
 * not help, because the lane has no `node_modules` at all. The installed lanes
 * keep their fully validated catalog read in `@shepherdjerred/version-catalog`.
 */
function readCatalogImageEntries(
  versionCatalogSource: string,
): readonly CatalogImageEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(versionCatalogSource);
  } catch (error) {
    throw new Error("version catalog is not valid JSON", { cause: error });
  }
  const entries = asRecord(raw)?.["entries"];
  if (!Array.isArray(entries)) {
    throw new TypeError("version catalog has no entries array");
  }
  return entries.map((candidate: unknown, index) => {
    const entry = asRecord(candidate);
    return {
      name: requiredString(entry, "name", index),
      value: requiredString(entry, "value", index),
      category: requiredString(entry, "category", index),
      artifactType: requiredString(entry, "artifactType", index),
    };
  });
}

function entriesByName(
  versionCatalogSource: string,
): ReadonlyMap<string, CatalogImageEntry> {
  const byName = new Map<string, CatalogImageEntry>();
  for (const entry of readCatalogImageEntries(versionCatalogSource)) {
    if (byName.has(entry.name)) {
      throw new Error(
        `version catalog names must be unique; ${entry.name} is duplicated`,
      );
    }
    byName.set(entry.name, entry);
  }
  return byName;
}

export function findManagedImagePin(
  versionCatalogSource: string,
  imageName: string,
): ManagedImagePin | undefined {
  const entries = entriesByName(versionCatalogSource);
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
