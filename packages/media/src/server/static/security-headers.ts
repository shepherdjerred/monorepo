import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/**
 * The response headers that say what a browser may do with a Media page, for
 * every response: the application shell, its assets, and the API.
 *
 * The client is self-contained, so the policy names no origin but its own:
 * one module script, one stylesheet, its own fonts, and `fetch` to `/api`.
 * Nothing inline, nothing evaluated from a string, no `data:` or `blob:`
 * resource, no plugin, and no frame in either direction. A new origin, or a
 * new kind of resource, needs its directive changed here with the reason;
 * `README.md` ("Security headers") carries the rule.
 *
 * The browser suite serves the built client behind this same middleware
 * (`e2e/browser/server.ts`), so a client change the policy would block fails
 * there. The Vite dev server does not use it: hot reload needs inline and
 * evaluated script.
 */
export function mediaSecurityHeaders(): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
    // Agrees with `frame-ancestors 'none'` for a browser that reads only this.
    xFrameOptions: "DENY",
  });
}
