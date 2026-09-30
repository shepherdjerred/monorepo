/**
 * Cross-surface origins for root-relative links out of the SPA.
 *
 * In production and beta the three surfaces share one origin, so an unset
 * variable leaves links same-origin (`/docs/...`). Local development runs each
 * surface on its own port; the `VITE_*` origin variables (set by `dev:web`)
 * and these dev fallbacks keep navigation crossing the ports explicitly.
 */
function localSurfaceOrigin(
  configured: unknown,
  developmentFallback: string,
): string | undefined {
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  return import.meta.env.DEV ? developmentFallback : undefined;
}

export const marketingOrigin = localSurfaceOrigin(
  import.meta.env.VITE_MARKETING_ORIGIN,
  "http://localhost:4321",
);

export const docsOrigin = localSurfaceOrigin(
  import.meta.env.VITE_DOCS_ORIGIN,
  "http://localhost:4322",
);

/** A link into the Scout docs surface, origin-aware for local development. */
export function docsHref(path: string): string {
  return `${docsOrigin ?? ""}${path}`;
}
