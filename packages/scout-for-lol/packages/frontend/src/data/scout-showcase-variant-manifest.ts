import {
  ShowcaseVariantManifestSchema,
  type ShowcaseVariantManifest,
} from "#src/data/scout-showcase-variants.ts";

/**
 * The renditions manifest, resolved by Vite when the page is built.
 *
 * A glob rather than a static import, so type checking does not depend on the
 * generator having run. A page build without it fails here instead of
 * shipping image URLs that 404. Kept apart from `scout-showcase-variants.ts`
 * because the generator script imports that module outside Vite.
 */
const manifests = import.meta.glob<{ default: unknown }>(
  "./generated/scout-showcase-variants.json",
  { eager: true },
);

export function loadShowcaseVariantManifest(): ShowcaseVariantManifest {
  const [manifest] = Object.values(manifests);
  if (manifest === undefined) {
    throw new Error(
      "Missing src/data/generated/scout-showcase-variants.json; run scripts/optimize-showcase-images.ts (the dev and build scripts do)",
    );
  }
  return ShowcaseVariantManifestSchema.parse(manifest.default);
}
