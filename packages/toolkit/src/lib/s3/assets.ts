import path from "node:path";

/** Bucket that backs https://public.sjer.red (Caddy s3proxy static site). */
export const PUBLIC_BUCKET = "public-sjer-red";

/** Public origin Caddy serves the bucket from. */
export const PUBLIC_HOST = "https://public.sjer.red";

/**
 * Content types keyed by lowercase file extension. Setting an accurate type on
 * upload matters because the static site is served with
 * `X-Content-Type-Options: nosniff` — browsers refuse octet-stream
 * scripts/styles outright — and GitHub's image proxy only renders responses
 * with an image content type.
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
  ".cast": "application/x-asciicast",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

/** Best-effort content type for a filename; octet-stream when unknown. */
export function contentTypeForFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Whether the filename is an asciinema recording (`.cast`). */
export function isCastFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".cast";
}

/** S3 object key for a PR asset: `pr/assets/<number>/<basename>`. */
export function assetKey(prNumber: number, filename: string): string {
  return `pr/assets/${String(prNumber)}/${path.basename(filename)}`;
}

/**
 * S3 object key for one file inside an uploaded directory:
 * `pr/assets/<number>/<dirName>/<posix relative path>`.
 */
export function dirFileKey(
  prNumber: number,
  dirName: string,
  relativePath: string,
): string {
  return `pr/assets/${String(prNumber)}/${dirName}/${relativePath}`;
}

/** Public URL for an object key, with every path segment URL-encoded. */
export function publicUrlForKey(key: string): string {
  const encoded = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${PUBLIC_HOST}/${encoded}`;
}

/** Public URL for a PR asset, with the filename segment URL-encoded. */
export function assetPublicUrl(prNumber: number, filename: string): string {
  return publicUrlForKey(assetKey(prNumber, filename));
}

/**
 * Ready-to-paste markdown for an asset URL, by content-type class (derived
 * from the same extension map used for uploads, so the two cannot drift):
 *
 * - images → `![name](url)` — GitHub's camo proxy renders these inline
 *   (GIFs animate)
 * - video → `[name (video)](url)` — GitHub never embeds external video; the
 *   link plays in a browser tab because the object is served with a real
 *   video content type
 * - HTML → `[name (demo)](url)`, PDF → `[name (pdf)](url)`
 * - anything else → `[name](url)`
 *
 * `.cast` files are not handled here: the command links the generated player
 * page (an HTML asset) instead of the raw recording.
 */
export function markdownForAsset(filename: string, url: string): string {
  const name = path.basename(filename);
  const contentType = contentTypeForFile(name);
  if (contentType.startsWith("image/")) {
    return `![${name}](${url})`;
  }
  if (contentType.startsWith("video/")) {
    return `[${name} (video)](${url})`;
  }
  if (contentType.startsWith("text/html")) {
    return `[${name} (demo)](${url})`;
  }
  if (contentType === "application/pdf") {
    return `[${name} (pdf)](${url})`;
  }
  return `[${name}](${url})`;
}

export type KeyedUpload = {
  /** Full S3 object key the upload would write. */
  key: string;
  /** Human-readable description of where the upload came from. */
  source: string;
};

/**
 * Return the first pair of planned uploads that target the same object key
 * (and would silently overwrite each other), or undefined if all keys are
 * unique. Covers file-vs-file basenames, directory-vs-file collisions, and
 * generated artifacts like `.cast` player pages.
 */
export function firstDuplicateKey(
  uploads: KeyedUpload[],
): { key: string; first: string; second: string } | undefined {
  const seen = new Map<string, string>();
  for (const upload of uploads) {
    const previous = seen.get(upload.key);
    if (previous !== undefined) {
      return { key: upload.key, first: previous, second: upload.source };
    }
    seen.set(upload.key, upload.source);
  }
  return undefined;
}
