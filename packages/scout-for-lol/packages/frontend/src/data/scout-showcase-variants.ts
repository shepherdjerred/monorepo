import { z } from "zod";

/**
 * Responsive WebP renditions of the showcase PNGs the landing page shows.
 *
 * The bot-owned showcase PNGs are full-resolution captures (the hero is
 * 4864×3500, 3.5 MB) and stay untouched. `scripts/optimize-showcase-images.ts`
 * derives these renditions from them before `astro dev` and `astro build`, into
 * a gitignored directory, and writes the manifest the page reads.
 */

/** Showcase assets rendered on the landing page. */
export const LANDING_SHOWCASE_IDS = [
  "ranked-solo-1-postmatch",
  "classic-prematch",
  "ranked-solo-discord",
  "aram-discord",
  "arena-discord",
] as const;

/** Target rendition widths; a capture narrower than one is never upscaled. */
export const SHOWCASE_VARIANT_WIDTHS = [640, 1280, 1920] as const;

/** Public URL prefix and on-disk directory (under `public/`) of the renditions. */
export const SHOWCASE_VARIANT_PUBLIC_DIR =
  "/generated/scout-showcase/optimized";

/**
 * Manifest of the renditions actually written, relative to the package root.
 * Gitignored with the renditions; the landing page fails its build without it.
 */
export const SHOWCASE_VARIANT_MANIFEST =
  "src/data/generated/scout-showcase-variants.json";

export const ShowcaseVariantManifestSchema = z.record(
  z.string().min(1),
  z
    .array(
      z.strictObject({
        width: z.number().int().positive(),
        src: z.string().startsWith(`${SHOWCASE_VARIANT_PUBLIC_DIR}/`),
      }),
    )
    .min(1),
);

export type ShowcaseVariantManifest = z.infer<
  typeof ShowcaseVariantManifestSchema
>;

/** `srcset` value for one asset; throws when the asset has no renditions. */
export function showcaseSrcSet(
  manifest: ShowcaseVariantManifest,
  id: string,
): string {
  const variants = manifest[id];
  if (variants === undefined) {
    throw new Error(
      `No WebP renditions for showcase asset ${id}; run scripts/optimize-showcase-images.ts`,
    );
  }
  return variants
    .map((variant) => `${variant.src} ${variant.width.toString()}w`)
    .join(", ");
}
