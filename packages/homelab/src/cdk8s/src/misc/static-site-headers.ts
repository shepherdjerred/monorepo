/** Response headers of the static-site origin's Caddyfile. */

/**
 * Defense-in-depth response headers applied to every site. CSP is intentionally
 * NOT here — it's per-app because each app has different image hosts, inline
 * script needs, etc. Sites that need CSP set it via `responseHeaders`.
 *
 * HSTS deliberately uses `max-age=31536000` WITHOUT `includeSubDomains` or
 * `preload` as the default — a misconfigured subdomain could otherwise become
 * permanently unreachable from browsers. Sites that want broader HSTS scope opt
 * in via `responseHeaders`.
 */
export const defaultResponseHeaders: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

/**
 * Render a Caddyfile `header { ... }` block. Returns an empty string when
 * there are no headers to set.
 *
 * Caddy's `header` directive with an unprefixed name uses Set semantics — it
 * overwrites any upstream-provided value. `null` overrides emit a `-Name`
 * delete directive instead.
 */
export function renderHeaderValues(
  values: ReadonlyMap<string, string | null>,
  indentation: number,
  stripServer: boolean,
): string {
  const lines: string[] = [];
  const valueIndent = "\t".repeat(indentation + 1);
  for (const [name, value] of values) {
    if (value === null) {
      lines.push(`${valueIndent}-${name}`);
    } else {
      // Caddy requires quoting whenever the value contains spaces or special
      // chars. Always quote to keep the rendering deterministic.
      const escaped = value
        .replaceAll(`\\`, `\\\\`)
        .replaceAll(`"`, String.raw`\"`);
      lines.push(`${valueIndent}${name} "${escaped}"`);
    }
  }
  if (stripServer) lines.push(`${valueIndent}-Server`);

  if (lines.length === 0) return "";
  const blockIndent = "\t".repeat(indentation);
  return `${blockIndent}header {\n${lines.join("\n")}\n${blockIndent}}`;
}

/**
 * The merged default-and-per-site `header { ... }` block for one site. Never
 * empty, because `defaultResponseHeaders` is not.
 */
export function renderHeaderBlock(
  overrides: Record<string, string | null> | undefined,
): string {
  const merged = new Map<string, string | null>();
  for (const [name, value] of Object.entries(defaultResponseHeaders)) {
    merged.set(name, value);
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    merged.set(name, value);
  }
  return renderHeaderValues(merged, 1, true);
}
