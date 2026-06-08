import path from "node:path";

/** Bucket that backs https://public.sjer.red (Caddy s3proxy static site). */
export const PUBLIC_BUCKET = "public-sjer-red";

/** Public origin Caddy serves the bucket from. */
export const PUBLIC_HOST = "https://public.sjer.red";

/**
 * Content types keyed by lowercase file extension. Setting an accurate type on
 * upload matters because the static site is served with
 * `X-Content-Type-Options: nosniff`, and GitHub's image proxy only renders
 * responses with an image content type.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
};

/** Best-effort content type for a filename; octet-stream when unknown. */
export function contentTypeForFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** S3 object key for a PR asset: `pr/assets/<number>/<basename>`. */
export function assetKey(prNumber: number, filename: string): string {
  return `pr/assets/${String(prNumber)}/${path.basename(filename)}`;
}

/** Public URL for a PR asset, with the filename segment URL-encoded. */
export function assetPublicUrl(prNumber: number, filename: string): string {
  const base = encodeURIComponent(path.basename(filename));
  return `${PUBLIC_HOST}/pr/assets/${String(prNumber)}/${base}`;
}

/**
 * Return the first pair of files that share a basename (and would collide on the
 * same object key), or undefined if all basenames are unique.
 */
export function firstDuplicateBasename(
  files: string[],
): { basename: string; first: string; second: string } | undefined {
  const seen = new Map<string, string>();
  for (const file of files) {
    const base = path.basename(file);
    const previous = seen.get(base);
    if (previous !== undefined) {
      return { basename: base, first: previous, second: file };
    }
    seen.set(base, file);
  }
  return undefined;
}
