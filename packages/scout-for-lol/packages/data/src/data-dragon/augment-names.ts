import { AugmentNameCatalogSchema } from "./augment-names-schema.ts";
import augmentNamesData from "./assets/augment-names.json" with { type: "json" };

const catalog = AugmentNameCatalogSchema.parse(augmentNamesData);

/** Recorded augment names across game modes, not full Arena report metadata. */
export function getCachedAugmentNameById(id: number): string | undefined {
  return catalog.augments[id]?.name;
}
