import { ALLOWED_CDN_ORIGINS } from "#shared/contract.ts";
import { isTokenFormat } from "./paths.ts";

export type ContentOrigins = {
  /** `https://artifacts.tailnet-1a49.ts.net`: the only allowed frame parent. */
  appOrigin: string;
  /** `https://artifacts-content.tailnet-1a49.ts.net`. */
  contentOrigin: string;
};

const FONT_HOSTS = new Set([
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);
const SCRIPT_CDNS = ALLOWED_CDN_ORIGINS.filter(
  (origin) => !FONT_HOSTS.has(origin),
);

/** The path prefix of a version's content; sources are scoped to it. */
export function tokenPrefix(contentOrigin: string, token: string | null) {
  return token !== null && isTokenFormat(token)
    ? `${contentOrigin}/_t/${token}/`
    : `${contentOrigin}/_none/`;
}

/**
 * The Content-Security-Policy of every content response. `sandbox` without
 * `allow-same-origin` gives the page an opaque origin, so every `'self'`-like
 * source is spelled out as the request's own `/_t/<token>/` prefix plus the
 * bridge and viewer directories. Nothing else on the content origin, and no
 * other origin than the allowlisted CDNs, is reachable.
 */
export function contentSecurityPolicy(
  origins: ContentOrigins,
  token: string | null,
): string {
  const own = tokenPrefix(origins.contentOrigin, token);
  const bridge = `${origins.contentOrigin}/_bridge/`;
  const viewer = `${origins.contentOrigin}/_viewer/`;
  const cdns = ALLOWED_CDN_ORIGINS.join(" ");
  return [
    "sandbox allow-scripts allow-forms allow-popups",
    "default-src 'none'",
    `script-src ${own} ${bridge} ${viewer} 'unsafe-inline' 'unsafe-eval' blob: ${SCRIPT_CDNS.join(" ")}`,
    `style-src ${own} ${viewer} 'unsafe-inline' ${cdns}`,
    `font-src ${own} data: ${cdns}`,
    `img-src ${own} data: blob:`,
    `media-src ${own} data: blob:`,
    `connect-src ${own}`,
    `worker-src ${own} blob:`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origins.appOrigin}`,
  ].join("; ");
}

/** Headers present on every content response, whatever its status. */
export function contentHeaders(
  origins: ContentOrigins,
  token: string | null,
): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(origins, token),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, ETag",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

/**
 * The Content-Security-Policy of every app response. The UI itself is all
 * `'self'`; only the content origin may supply images, media, fetches and
 * frames (the artifacts it previews), and WebAssembly may compile (the
 * terminal player) while script text may never be evaluated. The e2e serves
 * this same policy, so the UI is proven to work under exactly what ships.
 */
export function appPolicy(contentOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${contentOrigin}`,
    `media-src ${contentOrigin} blob:`,
    `connect-src 'self' ${contentOrigin}`,
    `frame-src ${contentOrigin}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Headers of every app response: the UI is never framed and never shared. */
export function appHeaders(contentOrigin: string): Record<string, string> {
  return {
    "Content-Security-Policy": appPolicy(contentOrigin),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
