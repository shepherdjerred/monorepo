import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import {
  ArtworkFileSchema,
  ArtworkSizeSchema,
  type ArtworkContentType,
  type ArtworkSize,
} from "#shared/artwork/proxy.ts";
import { parseInput } from "#server/validation.ts";

/**
 * A size and file name always name the same picture, and changed art gets a
 * new file name, so a browser may keep a copy for a year without asking again.
 * The bytes are not fixed: TMDB's CDN may re-encode a file. `private` keeps a
 * shared cache in front of the origin from storing an image that is only
 * served to a signed-in member.
 */
const ARTWORK_CACHE_CONTROL = "private, max-age=31536000, immutable";

export function registerArtworkRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  artwork: {
    read: (
      size: ArtworkSize,
      file: string,
    ) => Promise<{
      bytes: Uint8Array<ArrayBuffer>;
      contentType: ArtworkContentType;
    }>;
  },
) {
  app.get("/api/v1/artwork/:size/:file", async (c) => {
    const image = await artwork.read(
      parseInput(ArtworkSizeSchema, c.req.param("size")),
      parseInput(ArtworkFileSchema, c.req.param("file")),
    );
    // Replaces the `no-store` every other response carries.
    c.header("Cache-Control", ARTWORK_CACHE_CONTROL);
    c.header("Content-Type", image.contentType);
    c.header("Content-Length", String(image.bytes.byteLength));
    return c.body(image.bytes);
  });
}
