import { z } from "zod";

/**
 * TMDB image widths the artwork route serves. `original` is deliberately
 * absent: it is unbounded in size and no layout needs it.
 */
export const ArtworkSizeSchema = z.enum([
  "w185",
  "w342",
  "w500",
  "w780",
  "w1280",
]);
export type ArtworkSize = z.infer<typeof ArtworkSizeSchema>;

/** A TMDB image file name. SVG is never accepted. */
export const ArtworkFileSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{8,64}\.(?:jpg|png)$/u);

export type ArtworkContentType = "image/jpeg" | "image/png";

/** The only content type a file name of this extension may be served as. */
export function artworkContentType(file: string): ArtworkContentType {
  return file.endsWith(".png") ? "image/png" : "image/jpeg";
}

const SIGNATURES: Record<ArtworkContentType, readonly number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** Whether the bytes are non-empty and start with the type's file signature. */
export function hasArtworkSignature(
  type: ArtworkContentType,
  bytes: Uint8Array,
): boolean {
  const signature = SIGNATURES[type];
  return (
    bytes.byteLength > signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}
