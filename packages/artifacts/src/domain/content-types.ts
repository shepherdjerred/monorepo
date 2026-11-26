/**
 * Media types the content host serves inline. Anything else is sent as
 * `application/octet-stream` with `Content-Disposition: attachment`, so an
 * unknown type can never be sniffed into something executable.
 */
const INLINE_EXACT = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/vtt",
  "application/json",
  "application/pdf",
  "application/wasm",
  "application/x-asciicast",
  "application/xml",
  "text/xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/x-icon",
  "image/bmp",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/flac",
  "audio/aac",
]);
const INLINE_PREFIXES = ["font/"];
const MEDIA_TYPE =
  /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:\s*;\s*[\w-]+=(?:[\w.+-]+|"[\w .+-]*"))*$/u;

export const OCTET_STREAM = "application/octet-stream";

export type ServedType = {
  contentType: string;
  /** True when the browser may render it; false forces a download. */
  inline: boolean;
};

/** The bare `type/subtype` of a media type, lowercased. */
export function essence(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

export function servedType(mediaType: string): ServedType {
  if (!MEDIA_TYPE.test(mediaType)) return forceDownload();
  const base = essence(mediaType);
  const inline =
    INLINE_EXACT.has(base) ||
    INLINE_PREFIXES.some((prefix) => base.startsWith(prefix));
  return inline ? { contentType: mediaType, inline: true } : forceDownload();
}

function forceDownload(): ServedType {
  return { contentType: OCTET_STREAM, inline: false };
}

export function isHtml(mediaType: string): boolean {
  return essence(mediaType) === "text/html";
}
