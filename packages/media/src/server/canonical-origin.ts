import type { MiddlewareHandler } from "hono";

const PREVIOUS_MEDIA_HOST = "media.tailnet-1a49.ts.net";

/** Preserve the previous owner bookmark without granting it write-origin authority.
 * Host is the actual request URL, never a forwarded-host header. The ingress's
 * internal HTTP transport is permitted; only this exact host is an alias. */
export function canonicalMediaHtmlOrigin(
  publicOrigin: string,
): MiddlewareHandler {
  const canonical = new URL(publicOrigin).origin;
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (
      url.host === PREVIOUS_MEDIA_HOST &&
      url.origin !== canonical &&
      ["GET", "HEAD"].includes(c.req.method) &&
      acceptsHtml(c.req.header("Accept")) &&
      !["/api", "/assets"].some(
        (prefix) =>
          url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      ) &&
      !["/health", "/readyz", "/metrics"].includes(url.pathname)
    ) {
      const target = new URL(canonical);
      target.pathname = url.pathname;
      target.search = url.search;
      c.header("Cache-Control", "no-store");
      return c.redirect(target.toString(), 308);
    }
    return next();
  };
}

function acceptsHtml(value: string | undefined) {
  return (
    value?.split(",").some((part) => {
      const [type, ...parameters] = part.trim().split(";");
      return (
        type === "text/html" &&
        !parameters.some((parameter) =>
          /^q=0(?:\.0*)?$/u.test(parameter.trim()),
        )
      );
    }) === true
  );
}
