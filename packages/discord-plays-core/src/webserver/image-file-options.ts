/**
 * Static-file options for game web assets that ship inside an image.
 *
 * Image builds clamp every file mtime to one fixed epoch (`SOURCE_DATE_EPOCH`
 * in docker-bake.hcl) so unchanged layers reproduce byte for byte. Stat-derived
 * validators would then stay equal across releases whose files changed only in
 * content: express's ETag is size plus mtime, and Last-Modified is the mtime.
 * A browser revalidating with them would receive 304 and keep stale code, so
 * static directories carry no validators. Serve a single image file with
 * `res.send` instead, whose ETag derives from the bytes.
 */
export const IMAGE_FILE_OPTIONS = {
  etag: false,
  lastModified: false,
} as const;
