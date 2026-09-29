import type { ImageFetcher } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { z } from "zod";

const CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const PIN_PATHS = new Set([CATALOG_PATH, "scripts/pin-candidates-state.json"]);
const PIN_VALUE = /^.+@sha256:[a-f0-9]{64}$/u;
const CatalogSchema = z.looseObject({
  entries: z.array(
    z.looseObject({
      name: z.string(),
      value: z.string(),
      category: z.string(),
      artifactType: z.string(),
      management: z.looseObject({ managed: z.boolean() }),
    }),
  ),
});

/** A missing or unexpected catalog comparison keeps the complete main graph. */
export async function isInternalImagePinChange(
  changedFiles: readonly string[],
  base: string | undefined,
  head: string,
  fetcher: ImageFetcher,
): Promise<boolean> {
  if (
    base === undefined ||
    !/^[a-f0-9]{40}$/u.test(base) ||
    !/^[a-f0-9]{40}$/u.test(head) ||
    changedFiles.length === 0 ||
    !changedFiles.every((path) => PIN_PATHS.has(path))
  ) {
    return false;
  }
  try {
    const [beforeSource, afterSource] = await Promise.all([
      fetcher(CATALOG_PATH, base).then(
        (source) => JSON.parse(source) as unknown,
      ),
      fetcher(CATALOG_PATH, head).then(
        (source) => JSON.parse(source) as unknown,
      ),
    ]);
    const before = CatalogSchema.safeParse(beforeSource);
    const after = CatalogSchema.safeParse(afterSource);
    if (!before.success || !after.success) return false;
    const oldEntries = before.data.entries;
    const newEntries = after.data.entries;
    if (oldEntries.length !== newEntries.length) return false;
    const normalized = newEntries.map((entry, index) => {
      const oldEntry = oldEntries[index];
      if (oldEntry === undefined || entry.value === oldEntry.value)
        return entry;
      return entry.category !== "internal-image" ||
        entry.artifactType !== "image" ||
        entry.management.managed ||
        !PIN_VALUE.test(entry.value) ||
        !PIN_VALUE.test(oldEntry.value)
        ? entry
        : { ...entry, value: oldEntry.value };
    });
    return (
      JSON.stringify({ ...after.data, entries: normalized }) ===
      JSON.stringify(before.data)
    );
  } catch {
    return false;
  }
}

/** Keep image publication and every consumer of its release handoffs. */
const PIN_ONLY_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  verify: [],
  "homelab-release-admission": [],
  images: ["verify", "homelab-release-admission"],
  "helm-push": ["homelab-release-admission", "images"],
  "argocd-sync": ["homelab-release-admission", "images", "helm-push"],
  "version-commit-back": ["images", "argocd-sync"],
  "scout-beta-release": ["images", "argocd-sync"],
  "scout-tag-release": ["scout-beta-release"],
  "scout-prod-reconcile": ["argocd-sync", "scout-beta-release"],
};

export function internalImagePinSteps(steps: readonly CiStep[]): CiStep[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  return Object.entries(PIN_ONLY_DEPENDENCIES).map(([key, dependsOn]) => {
    const step = byKey.get(key);
    if (step === undefined) throw new Error(`missing pin release step: ${key}`);
    return { ...step, dependsOn };
  });
}
