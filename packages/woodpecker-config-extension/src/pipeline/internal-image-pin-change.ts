import type { ImageFetcher } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { onlyInternalImagePinsChanged } from "@shepherdjerred/version-catalog/internal-image-pins";

const CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const PIN_PATHS = new Set([CATALOG_PATH]);

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
    return onlyInternalImagePinsChanged(beforeSource, afterSource);
  } catch {
    return false;
  }
}

export function internalImagePinSteps(steps: readonly CiStep[]): CiStep[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const required = new Set<string>();
  function include(key: string) {
    if (required.has(key)) return;
    const step = byKey.get(key);
    if (step === undefined)
      throw new Error(`Missing artifact producer dependency: ${key}`);
    required.add(key);
    for (const dependency of step.dependsOn ?? []) include(dependency);
  }
  for (const key of ["images", "helm-push", "scout-site-archives", "sites"])
    include(key);
  if (byKey.has("delivery-publish")) include("delivery-publish");
  return steps.filter((step) => required.has(step.key));
}
