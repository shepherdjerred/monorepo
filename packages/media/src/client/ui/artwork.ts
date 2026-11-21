import type { ArtworkSize } from "#shared/artwork/proxy.ts";

/**
 * The same-origin address of a TMDB image at one of the proxy's widths.
 * `path` is the size-less file path the API stores: a slash and a file name.
 */
export function artworkUrl(size: ArtworkSize, path: string): string {
  return `/api/v1/artwork/${size}/${encodeURIComponent(path.replace(/^\//u, ""))}`;
}

/** The poster widths a card can use, narrowest first, as a `srcset`. */
const POSTER_WIDTHS = [
  ["w185", 185],
  ["w342", 342],
  ["w500", 500],
] as const satisfies readonly (readonly [ArtworkSize, number])[];

export function posterSources(path: string): { src: string; srcSet: string } {
  return {
    // What a browser without `srcset` support would load.
    src: artworkUrl("w342", path),
    srcSet: POSTER_WIDTHS.map(
      ([size, width]) => `${artworkUrl(size, path)} ${String(width)}w`,
    ).join(", "),
  };
}
